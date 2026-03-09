import {
  DEFAULT_PLAYER,
  FIXED_REGION_ID,
  LIVE_WS,
  RUNTIME_AEL_CACHE_PATH,
  RUNTIME_CACHE_REFRESH_MS,
  TERRAIN_PATH,
  TRACKED_PLAYERS_CACHE_PATH,
  TRACKED_PLAYERS_CONFIG_PATH,
} from '../config';
import {
  isInsideFixedRegion,
  isFiniteNumber,
  makeOfficialLink,
  parseCenter,
  parseIdList,
  parseRequestedZoom,
  regionIdFromCoord,
  resolvePublicUrl,
  type WorldPoint,
} from '../shared/bitcraft';
import { parseLiveStateMessage } from '../shared/live-state';
import { normalizeDisplaySource, shouldKeepFreshLiveState } from '../shared/player-source';
import {
  aelRuntimeCacheSchema,
  resourceSnapshotSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
  type AelRuntimeCache,
  type RuntimePlayerCache,
  type TrackedPlayerConfigItem,
} from '../shared/schemas';
import { formatMaybe } from '../shared/strings';
import { getDom, type AppDom } from '../ui/dom';
import { fetchJsonValidated } from './fetch-json';
import { decideLiveUpdateTrust, type PendingLiveCandidate } from './live-trust';
import { MapController } from './map-controller';
import type { PlayerRecord, QueryState, RenderablePlayer } from './types';

interface AelPositionUpdate {
  x: number;
  z: number;
  regionId?: number | null;
  timestamp?: number | null;
  source?: string | null;
  signedIn?: boolean | null;
  lastLoginTimestamp?: string | null;
  destinationX?: number | null;
  destinationZ?: number | null;
}

export async function bootApp(): Promise<void> {
  const dom = getDom();
  const app = new OverlayApp(dom, new MapController(resolvePublicUrl(TERRAIN_PATH)), readQueryState());

  try {
    await app.boot();
  } catch (error) {
    console.error(error);
    dom.status.textContent = 'Boot error';
    dom.diagnosticsStatus.textContent = `Boot error: ${getErrorMessage(error)}`;
    dom.diagnosticsStatus.className = 'notice warn';
  }
}

class OverlayApp {
  private readonly trackedPlayers = new Map<string, PlayerRecord>();

  private aelKnown = false;
  private aelState: PlayerRecord | null = null;
  private runtimeCache: AelRuntimeCache | null = null;
  private terrainReady = false;
  private readonly pendingLiveCandidates = new Map<string, PendingLiveCandidate>();

  constructor(
    private readonly dom: AppDom,
    private readonly mapController: MapController,
    private readonly queryState: QueryState,
  ) {
    this.initializeStaticUi();
  }

  async boot(): Promise<void> {
    this.setupButtons();
    this.mapController.applyInitialView(this.queryState.requestedCenter, this.queryState.requestedZoom);
    this.mapController.drawRegionFrame();

    await Promise.all([
      this.verifyTerrain(),
      this.loadRuntimeCache(),
      this.loadTrackedPlayersCache(),
      this.loadRequestedResourceSnapshots(),
    ]);

    this.connectLiveFeeds();
    this.startRuntimePolling();
  }

  private initializeStaticUi(): void {
    this.dom.entityId.textContent = DEFAULT_PLAYER.entityId;
    this.dom.requestedRegions.textContent = `${FIXED_REGION_ID} (fixed build)`;
    this.dom.requestedResources.textContent =
      this.queryState.requestedResourceIds.length > 0 ? this.queryState.requestedResourceIds.join(', ') : 'none';
    this.dom.officialLink.href = makeOfficialLink(this.queryState.requestedResourceIds);
    this.dom.status.textContent = 'Booting';
    this.dom.coordSource.textContent = 'none';
    this.dom.diagnosticsStatus.textContent = 'Loading region-12 terrain, runtime cache, and live feed...';
  }

  private setupButtons(): void {
    this.dom.recenterBtn.addEventListener('click', () => {
      const point = this.getKnownAelPoint();
      if (!point) return;
      this.mapController.recenter(point);
    });

    this.dom.manualPinBtn.addEventListener('click', () => {
      const point = this.readManualPoint();
      if (!point) return;

      if (!isInsideFixedRegion(point)) {
        this.dom.diagnosticsStatus.textContent = 'Manual pin rejected: this build only shows region 12.';
        this.dom.diagnosticsStatus.className = 'notice warn';
        return;
      }

      this.mapController.setManualPin(point);
      this.mapController.recenter(point);
      this.refreshDiagnostics();
    });

    this.dom.clearManualPinBtn.addEventListener('click', () => {
      this.mapController.clearManualPin();
      this.refreshDiagnostics();
    });
  }

  private readManualPoint(): WorldPoint | null {
    const x = Number(this.dom.manualX.value);
    const z = Number(this.dom.manualZ.value);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      this.dom.diagnosticsStatus.textContent = 'Manual pin requires finite X and Z values.';
      this.dom.diagnosticsStatus.className = 'notice warn';
      return null;
    }
    return { x, z };
  }

  private async verifyTerrain(): Promise<void> {
    const loaded = await this.mapController.verifyTerrainImage();
    if (!loaded) {
      this.dom.diagnosticsStatus.textContent = 'Region-12 terrain image failed to load.';
      this.dom.diagnosticsStatus.className = 'notice warn';
      return;
    }

    this.terrainReady = true;
    this.refreshDiagnostics();
  }

  private async loadRuntimeCache(): Promise<void> {
    try {
      const cache = await fetchJsonValidated(
        resolvePublicUrl(RUNTIME_AEL_CACHE_PATH),
        aelRuntimeCacheSchema,
        'Ael runtime cache',
        { cacheBust: true },
      );
      this.runtimeCache = cache;
      if (!cache || !isFiniteNumber(cache.x) || !isFiniteNumber(cache.z)) return;

      this.setAelPosition({
        x: cache.x,
        z: cache.z,
        regionId: cache.regionId ?? regionIdFromCoord(cache.x, cache.z),
        timestamp: cache.timestamp ?? null,
        source: normalizeDisplaySource(cache.source),
        signedIn: cache.signedIn ?? true,
        lastLoginTimestamp: cache.lastLoginTimestamp ?? null,
      });
      this.dom.status.textContent = 'Runtime baseline acquired';
    } catch (error) {
      console.warn('Runtime cache load failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private async loadTrackedPlayersCache(): Promise<void> {
    try {
      const [config, cacheRows] = await Promise.all([
        fetchJsonValidated(
          resolvePublicUrl(TRACKED_PLAYERS_CONFIG_PATH),
          trackedPlayerConfigSchema,
          'Tracked player config',
          { cacheBust: true },
        ),
        fetchJsonValidated(
          resolvePublicUrl(TRACKED_PLAYERS_CACHE_PATH),
          trackedPlayersRuntimeCacheSchema,
          'Tracked player runtime cache',
          { cacheBust: true },
        ),
      ]);

      const configRows = config ?? [];
      const runtimeRows = cacheRows ?? [];
      const runtimeById = new Map(runtimeRows.map((row) => [String(row.entityId), row]));

      this.trackedPlayers.clear();
      for (const player of configRows) {
        this.trackedPlayers.set(player.entityId, this.mergePlayerConfig(player, runtimeById.get(player.entityId)));
      }

      this.renderTrackedPlayers();
      this.fitToKnownPlayers();
    } catch (error) {
      console.warn('Tracked players cache load failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private mergePlayerConfig(player: TrackedPlayerConfigItem, runtimeRow?: RuntimePlayerCache): PlayerRecord {
    return {
      username: player.username,
      entityId: player.entityId,
      x: runtimeRow?.x ?? null,
      z: runtimeRow?.z ?? null,
      regionId: runtimeRow?.regionId ?? null,
      timestamp: runtimeRow?.timestamp ?? null,
      source: normalizeDisplaySource(runtimeRow?.source),
      signedIn: runtimeRow?.signedIn ?? null,
      lastLoginTimestamp: runtimeRow?.lastLoginTimestamp ?? null,
      destinationX: runtimeRow?.destinationX ?? null,
      destinationZ: runtimeRow?.destinationZ ?? null,
    };
  }

  private async loadRequestedResourceSnapshots(): Promise<void> {
    const { requestedResourceIds } = this.queryState;
    if (requestedResourceIds.length === 0) {
      this.dom.resourceStatus.textContent = 'No region-12 resource snapshot requested.';
      this.dom.resourceStatus.className = 'notice';
      return;
    }

    const loaded: Array<{ resourceId: number; count: number }> = [];
    const missing: string[] = [];

    for (const resourceId of requestedResourceIds) {
      const snapshot = await fetchJsonValidated(
        resolvePublicUrl(`./data/resources/${FIXED_REGION_ID}/${resourceId}.json`),
        resourceSnapshotSchema,
        `Resource snapshot ${resourceId}`,
      );

      if (!snapshot) {
        missing.push(`${FIXED_REGION_ID}/${resourceId}`);
        continue;
      }

      const points = snapshot.features.flatMap((feature) =>
        feature.geometry.coordinates.map(([x, z]) => ({ x, z })),
      );
      const renderedCount = this.mapController.addResourcePoints(points);
      loaded.push({ resourceId, count: renderedCount });
    }

    if (loaded.length > 0) {
      const summary = loaded
        .map((item) => `resource ${item.resourceId} in region ${FIXED_REGION_ID}: ${item.count} points`)
        .join(' · ');
      this.dom.resourceStatus.textContent = `Loaded cached region-12 snapshot: ${summary}`;
      this.dom.resourceStatus.className = 'notice';
    } else {
      this.dom.resourceStatus.textContent = 'Requested region-12 resource snapshot not cached here yet.';
      this.dom.resourceStatus.className = 'notice warn';
    }

    if (missing.length > 0) {
      console.warn('Missing cached resources', missing);
    }
  }

  private startRuntimePolling(): void {
    window.setInterval(() => {
      void this.refreshAelFromRuntimeCache();
      void this.refreshTrackedPlayersFromRuntimeCache();
    }, RUNTIME_CACHE_REFRESH_MS);
  }

  private connectLiveFeeds(): void {
    this.dom.status.textContent = this.runtimeCache ? 'Waiting for live feed' : 'Connecting to live feed';
    const ws = new WebSocket(LIVE_WS);

    ws.addEventListener('open', () => {
      const channels = [
        `mobile_entity_state:${DEFAULT_PLAYER.entityId}`,
        ...Array.from(this.trackedPlayers.values()).map((player) => `mobile_entity_state:${player.entityId}`),
      ];

      this.dom.status.textContent = this.runtimeCache ? 'Subscribed · waiting live' : 'Subscribed';
      ws.send(JSON.stringify({ type: 'subscribe', channels }));
      this.refreshDiagnostics();
    });

    ws.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch (error) {
        console.warn('Failed to parse websocket message', error);
        return;
      }

      const liveState = parseLiveStateMessage(parsed, 'Live websocket payload');
      if (!liveState || !liveState.entityId || !isFiniteNumber(liveState.x) || !isFiniteNumber(liveState.z)) {
        return;
      }

      const livePoint = { x: liveState.x, z: liveState.z };
      if (!isInsideFixedRegion(livePoint)) {
        console.warn('Ignoring off-map live update for fixed region-12 build', liveState);
        return;
      }

      const currentPlayer =
        liveState.entityId === DEFAULT_PLAYER.entityId
          ? this.aelState
          : (this.trackedPlayers.get(liveState.entityId) ?? null);
      const trustDecision = decideLiveUpdateTrust(
        liveState.entityId,
        currentPlayer,
        liveState,
        this.pendingLiveCandidates.get(liveState.entityId) ?? null,
      );
      if (trustDecision.nextPending) {
        this.pendingLiveCandidates.set(liveState.entityId, trustDecision.nextPending);
      } else {
        this.pendingLiveCandidates.delete(liveState.entityId);
      }
      if (!trustDecision.accept) {
        console.warn('Holding suspicious live update pending confirmation', liveState);
        return;
      }

      if (liveState.entityId === DEFAULT_PLAYER.entityId) {
        this.setAelPosition({
          x: liveState.x,
          z: liveState.z,
          regionId: liveState.regionId ?? regionIdFromCoord(liveState.x, liveState.z),
          timestamp: liveState.timestamp,
          source: 'live',
          signedIn: true,
          destinationX: liveState.destinationX,
          destinationZ: liveState.destinationZ,
        });
        this.dom.status.textContent = liveState.isWalking ? 'Live · walking' : 'Live';
      } else if (this.trackedPlayers.has(liveState.entityId)) {
        this.updateTrackedPlayer(liveState.entityId, {
          x: liveState.x,
          z: liveState.z,
          regionId: liveState.regionId ?? regionIdFromCoord(liveState.x, liveState.z),
          timestamp: liveState.timestamp,
          source: 'live',
          signedIn: true,
          destinationX: liveState.destinationX,
          destinationZ: liveState.destinationZ,
        });
      }

      this.refreshDiagnostics();
    });

    ws.addEventListener('close', () => {
      if (!this.aelKnown) {
        this.dom.status.textContent = this.runtimeCache ? 'Live feed closed · showing cached position' : 'Live feed closed';
      }
      this.refreshDiagnostics();
    });

    ws.addEventListener('error', () => {
      if (!this.aelKnown) {
        this.dom.status.textContent = this.runtimeCache ? 'Live feed error · showing cached position' : 'Live feed error';
      }
      this.refreshDiagnostics();
    });
  }

  private async refreshAelFromRuntimeCache(): Promise<void> {
    try {
      const cache = await fetchJsonValidated(
        resolvePublicUrl(RUNTIME_AEL_CACHE_PATH),
        aelRuntimeCacheSchema,
        'Ael runtime cache refresh',
        { cacheBust: true },
      );
      this.runtimeCache = cache;
      if (!cache || shouldKeepFreshLiveState(this.aelState)) return;
      if (!isFiniteNumber(cache.x) || !isFiniteNumber(cache.z)) return;

      this.setAelPosition({
        x: cache.x,
        z: cache.z,
        regionId: cache.regionId ?? regionIdFromCoord(cache.x, cache.z),
        timestamp: cache.timestamp ?? null,
        source: normalizeDisplaySource(cache.source),
        signedIn: cache.signedIn ?? true,
        lastLoginTimestamp: cache.lastLoginTimestamp ?? null,
      });
      this.dom.status.textContent = 'Runtime refresh';
    } catch (error) {
      console.warn('Ael runtime refresh failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private async refreshTrackedPlayersFromRuntimeCache(): Promise<void> {
    try {
      const rows = await fetchJsonValidated(
        resolvePublicUrl(TRACKED_PLAYERS_CACHE_PATH),
        trackedPlayersRuntimeCacheSchema,
        'Tracked player runtime refresh',
        { cacheBust: true },
      );
      if (!rows) return;

      for (const row of rows) {
        const current = this.trackedPlayers.get(String(row.entityId));
        if (!current || shouldKeepFreshLiveState(current)) continue;
        this.updateTrackedPlayer(String(row.entityId), {
          x: row.x ?? current.x,
          z: row.z ?? current.z,
          regionId: row.regionId ?? current.regionId,
          timestamp: row.timestamp ?? current.timestamp,
          source: normalizeDisplaySource(row.source),
          signedIn: row.signedIn ?? current.signedIn,
          lastLoginTimestamp: row.lastLoginTimestamp ?? current.lastLoginTimestamp,
          destinationX: row.destinationX ?? current.destinationX ?? null,
          destinationZ: row.destinationZ ?? current.destinationZ ?? null,
        });
      }
    } catch (error) {
      console.warn('Tracked-player runtime refresh failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private setAelPosition(next: AelPositionUpdate): void {
    const regionId = next.regionId ?? regionIdFromCoord(next.x, next.z);

    this.aelState = {
      username: DEFAULT_PLAYER.username,
      entityId: DEFAULT_PLAYER.entityId,
      x: next.x,
      z: next.z,
      regionId,
      timestamp: next.timestamp ?? null,
      source: next.source ?? 'unknown',
      signedIn: next.signedIn ?? true,
      lastLoginTimestamp: next.lastLoginTimestamp ?? this.aelState?.lastLoginTimestamp ?? null,
      destinationX: next.destinationX ?? null,
      destinationZ: next.destinationZ ?? null,
    };

    this.dom.coordSource.textContent = this.aelState.source ?? 'unknown';
    this.dom.coordX.textContent = next.x.toFixed(3);
    this.dom.coordZ.textContent = next.z.toFixed(3);
    this.dom.coordRegion.textContent = String(regionId ?? 'unknown');
    this.dom.coordTimestamp.textContent = next.timestamp != null ? String(next.timestamp) : 'unknown';
    this.aelKnown = true;
    this.mapController.renderPlayers(this.getRenderablePlayers());

    if (regionId != null && regionId !== FIXED_REGION_ID) {
      this.dom.diagnosticsStatus.textContent = `Ael moved outside region 12 (now in region ${regionId}). This build stays locked to region 12.`;
      this.dom.diagnosticsStatus.className = 'notice warn';
      return;
    }

    if (this.dom.followToggle.checked && isInsideFixedRegion({ x: next.x, z: next.z })) {
      this.mapController.recenter({ x: next.x, z: next.z });
    }
  }

  private updateTrackedPlayer(entityId: string, patch: Partial<PlayerRecord>): void {
    const previous = this.trackedPlayers.get(entityId) ?? {
      username: entityId,
      entityId,
      x: null,
      z: null,
      regionId: null,
      timestamp: null,
      source: null,
      signedIn: null,
      lastLoginTimestamp: null,
      destinationX: null,
      destinationZ: null,
    };

    this.trackedPlayers.set(entityId, {
      ...previous,
      ...patch,
      entityId,
      username: patch.username ?? previous.username,
      source: patch.source ?? previous.source,
    });
    this.renderTrackedPlayers();
  }

  private renderTrackedPlayers(): void {
    this.renderTrackedPlayersList();
    this.mapController.renderPlayers(this.getRenderablePlayers());
  }

  private renderTrackedPlayersList(): void {
    const rows = Array.from(this.trackedPlayers.values()).sort((left, right) => left.username.localeCompare(right.username));
    this.dom.trackedPlayersList.replaceChildren();

    for (const player of rows) {
      const point = isFiniteNumber(player.x) && isFiniteNumber(player.z) ? { x: player.x, z: player.z } : null;
      const region = point ? player.regionId ?? regionIdFromCoord(point.x, point.z) : player.regionId;
      const onMap = point != null && isInsideFixedRegion(point) && region === FIXED_REGION_ID;

      const card = document.createElement('div');
      card.className = 'tracked-player';

      const head = document.createElement('div');
      head.className = 'tracked-player-head';

      const name = document.createElement('span');
      name.textContent = player.username;
      const status = document.createElement('span');
      status.textContent = onMap ? 'on map' : 'off map';
      head.append(name, status);

      const meta = document.createElement('div');
      meta.className = 'tracked-player-meta';
      appendLine(meta, `X ${formatMaybe(player.x)} · Z ${formatMaybe(player.z)}`);
      appendLine(meta, `region ${region ?? '-'} · source ${player.source ?? 'unknown'}`);
      appendLine(
        meta,
        `signed in ${player.signedIn === true ? 'yes' : player.signedIn === false ? 'no' : 'unknown'}`,
      );

      card.append(head, meta);
      this.dom.trackedPlayersList.appendChild(card);
    }
  }

  private getRenderablePlayers(): RenderablePlayer[] {
    const players: RenderablePlayer[] = [];

    const ael = this.toRenderablePlayer(this.aelState);
    if (ael) {
      players.push(ael);
    }

    for (const player of this.trackedPlayers.values()) {
      const renderable = this.toRenderablePlayer(player);
      if (renderable) {
        players.push(renderable);
      }
    }

    return players.sort((left, right) => left.username.localeCompare(right.username));
  }

  private toRenderablePlayer(player: PlayerRecord | null): RenderablePlayer | null {
    if (!player || !isFiniteNumber(player.x) || !isFiniteNumber(player.z)) {
      return null;
    }

    const point = { x: player.x, z: player.z };
    const regionId = player.regionId ?? regionIdFromCoord(player.x, player.z);
    if (regionId !== FIXED_REGION_ID || !isInsideFixedRegion(point)) {
      return null;
    }

    return {
      ...player,
      x: point.x,
      z: point.z,
      regionId,
    };
  }

  private fitToKnownPlayers(): void {
    this.mapController.fitToPlayers(this.getRenderablePlayers());
  }

  private refreshDiagnostics(): void {
    const parts = [
      this.terrainReady ? 'region12 terrain ok' : 'terrain pending',
      this.runtimeCache ? 'ael cache ok' : 'no ael cache',
      `${this.trackedPlayers.size} tracked players + Ael`,
      this.aelKnown ? 'all map players rendered' : 'waiting on Ael',
      `view z=${this.mapController.getZoom().toFixed(1)}`,
    ];

    this.dom.diagnosticsStatus.textContent = `Diagnostics: ${parts.join(' · ')}`;
    this.dom.diagnosticsStatus.className = this.aelKnown || this.terrainReady ? 'notice' : 'notice warn';
  }

  private getKnownAelPoint(): WorldPoint | null {
    if (!this.aelState || !isFiniteNumber(this.aelState.x) || !isFiniteNumber(this.aelState.z)) {
      return null;
    }

    return { x: this.aelState.x, z: this.aelState.z };
  }
}

function readQueryState(): QueryState {
  const params = new URLSearchParams(window.location.search);
  return {
    requestedResourceIds: parseIdList(params.get('resourceId')),
    requestedCenter: parseCenter(params.get('center')),
    requestedZoom: parseRequestedZoom(params.get('zoom')),
  };
}

function appendLine(parent: HTMLElement, text: string): void {
  if (parent.childNodes.length > 0) {
    parent.appendChild(document.createElement('br'));
  }
  parent.appendChild(document.createTextNode(text));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
