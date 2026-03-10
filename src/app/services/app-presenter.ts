import { DEFAULT_PLAYER, FIXED_REGION_ID } from '../../config';
import { isFiniteNumber, isInsideFixedRegion, makeOfficialLink, regionIdFromCoord, type WorldPoint } from '../../shared/bitcraft';
import { formatMaybe } from '../../shared/strings';
import type { AppDom } from '../../ui/dom';
import type { PlayerRecord, QueryState } from '../types';

export interface DiagnosticsViewState {
  terrainReady: boolean;
  hasRuntimeCache: boolean;
  trackedPlayerCount: number;
  aelKnown: boolean;
  zoom: number;
}

export interface ResourceRenderSummary {
  resourceId: number;
  count: number;
}

interface TrackedPlayerViewState {
  entityId: string;
  username: string;
  onMap: boolean;
  statusText: string;
  coordLine: string;
  sourceLine: string;
  signedInLine: string;
  signature: string;
}

interface TrackedPlayerCardRefs {
  root: HTMLDivElement;
  name: HTMLSpanElement;
  status: HTMLSpanElement;
  coordLine: HTMLDivElement;
  sourceLine: HTMLDivElement;
  signedInLine: HTMLDivElement;
  signature: string;
}

export class AppPresenter {
  private readonly trackedPlayerCards = new Map<string, TrackedPlayerCardRefs>();

  constructor(private readonly dom: AppDom) {}

  initializeStaticUi(queryState: QueryState): void {
    this.dom.entityId.textContent = DEFAULT_PLAYER.entityId;
    this.dom.requestedRegions.textContent = `${FIXED_REGION_ID} (fixed build)`;
    this.dom.requestedResources.textContent =
      queryState.requestedResourceIds.length > 0 ? queryState.requestedResourceIds.join(', ') : 'none';
    this.dom.officialLink.href = makeOfficialLink(queryState.requestedResourceIds);
    this.dom.status.textContent = 'Booting';
    this.dom.coordSource.textContent = 'none';
    this.dom.diagnosticsStatus.textContent = 'Loading region-12 terrain, runtime cache, and live feed...';
  }

  handleBootError(error: unknown): void {
    this.dom.status.textContent = 'Boot error';
    this.dom.diagnosticsStatus.textContent = `Boot error: ${getErrorMessage(error)}`;
    this.dom.diagnosticsStatus.className = 'notice warn';
  }

  bindRecenter(handler: () => void): void {
    this.dom.recenterBtn.addEventListener('click', handler);
  }

  bindManualPin(handler: () => void): void {
    this.dom.manualPinBtn.addEventListener('click', handler);
  }

  bindClearManualPin(handler: () => void): void {
    this.dom.clearManualPinBtn.addEventListener('click', handler);
  }

  readManualPoint(): WorldPoint | null {
    const x = Number(this.dom.manualX.value);
    const z = Number(this.dom.manualZ.value);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      this.dom.diagnosticsStatus.textContent = 'Manual pin requires finite X and Z values.';
      this.dom.diagnosticsStatus.className = 'notice warn';
      return null;
    }

    return { x, z };
  }

  shouldFollowPlayer(): boolean {
    return this.dom.followToggle.checked;
  }

  setStatus(text: string): void {
    this.dom.status.textContent = text;
  }

  showManualPinRejected(): void {
    this.dom.diagnosticsStatus.textContent = 'Manual pin rejected: this build only shows region 12.';
    this.dom.diagnosticsStatus.className = 'notice warn';
  }

  showTerrainLoadFailed(): void {
    this.dom.diagnosticsStatus.textContent = 'Region-12 terrain image failed to load.';
    this.dom.diagnosticsStatus.className = 'notice warn';
  }

  renderAelPosition(player: PlayerRecord): void {
    this.dom.coordSource.textContent = player.source ?? 'unknown';
    this.dom.coordX.textContent = isFiniteNumber(player.x) ? player.x.toFixed(3) : '-';
    this.dom.coordZ.textContent = isFiniteNumber(player.z) ? player.z.toFixed(3) : '-';
    this.dom.coordRegion.textContent = String(player.regionId ?? 'unknown');
    this.dom.coordTimestamp.textContent = player.timestamp != null ? String(player.timestamp) : 'unknown';
  }

  showAelMovedOutsideRegion(regionId: number): void {
    this.dom.diagnosticsStatus.textContent =
      `Ael moved outside region 12 (now in region ${regionId}). This build stays locked to region 12.`;
    this.dom.diagnosticsStatus.className = 'notice warn';
  }

  showNoRequestedResources(): void {
    this.dom.resourceStatus.textContent = 'No region-12 resource snapshot requested.';
    this.dom.resourceStatus.className = 'notice';
  }

  showRequestedResourcesLoaded(loaded: ResourceRenderSummary[]): void {
    const summary = loaded
      .map((item) => `resource ${item.resourceId} in region ${FIXED_REGION_ID}: ${item.count} points`)
      .join(' · ');
    this.dom.resourceStatus.textContent = `Loaded cached region-12 snapshot: ${summary}`;
    this.dom.resourceStatus.className = 'notice';
  }

  showRequestedResourcesMissing(): void {
    this.dom.resourceStatus.textContent = 'Requested region-12 resource snapshot not cached here yet.';
    this.dom.resourceStatus.className = 'notice warn';
  }

  renderTrackedPlayers(players: PlayerRecord[]): void {
    const rows = [...players].sort((left, right) => left.username.localeCompare(right.username));
    const seen = new Set<string>();
    let cursor = this.dom.trackedPlayersList.firstElementChild as HTMLElement | null;

    for (const player of rows) {
      const view = buildTrackedPlayerViewState(player);
      const card = this.upsertTrackedPlayerCard(view);
      seen.add(view.entityId);

      if (card.root !== cursor) {
        this.dom.trackedPlayersList.insertBefore(card.root, cursor);
      } else {
        cursor = cursor?.nextElementSibling as HTMLElement | null;
        continue;
      }

      cursor = card.root.nextElementSibling as HTMLElement | null;
    }

    for (const [entityId, card] of this.trackedPlayerCards.entries()) {
      if (seen.has(entityId)) {
        continue;
      }

      card.root.remove();
      this.trackedPlayerCards.delete(entityId);
    }
  }

  refreshDiagnostics(state: DiagnosticsViewState): void {
    const parts = [
      state.terrainReady ? 'region12 terrain ok' : 'terrain pending',
      state.hasRuntimeCache ? 'ael cache ok' : 'no ael cache',
      `${state.trackedPlayerCount} tracked players + Ael`,
      state.aelKnown ? 'all map players rendered' : 'waiting on Ael',
      `view z=${state.zoom.toFixed(1)}`,
    ];

    this.dom.diagnosticsStatus.textContent = `Diagnostics: ${parts.join(' · ')}`;
    this.dom.diagnosticsStatus.className = state.aelKnown || state.terrainReady ? 'notice' : 'notice warn';
  }

  private upsertTrackedPlayerCard(view: TrackedPlayerViewState): TrackedPlayerCardRefs {
    let card = this.trackedPlayerCards.get(view.entityId);
    if (!card) {
      card = createTrackedPlayerCard(view.entityId);
      this.trackedPlayerCards.set(view.entityId, card);
    }

    if (card.signature === view.signature) {
      return card;
    }

    card.name.textContent = view.username;
    card.status.textContent = view.statusText;
    card.status.className = view.onMap ? 'tracked-player-state' : 'tracked-player-state off-map';
    card.coordLine.textContent = view.coordLine;
    card.sourceLine.textContent = view.sourceLine;
    card.signedInLine.textContent = view.signedInLine;
    card.signature = view.signature;
    return card;
  }
}

function buildTrackedPlayerViewState(player: PlayerRecord): TrackedPlayerViewState {
  const point = isFiniteNumber(player.x) && isFiniteNumber(player.z) ? { x: player.x, z: player.z } : null;
  const region = point ? player.regionId ?? regionIdFromCoord(point.x, point.z) : player.regionId;
  const onMap = point != null && isInsideFixedRegion(point) && region === FIXED_REGION_ID;
  const statusText = onMap ? 'on map' : 'off map';
  const coordLine = `X ${formatMaybe(player.x)} · Z ${formatMaybe(player.z)}`;
  const sourceLine = `region ${region ?? '-'} · source ${player.source ?? 'unknown'}`;
  const signedInLine = `signed in ${player.signedIn === true ? 'yes' : player.signedIn === false ? 'no' : 'unknown'}`;

  return {
    entityId: player.entityId,
    username: player.username,
    onMap,
    statusText,
    coordLine,
    sourceLine,
    signedInLine,
    signature: [player.username, statusText, coordLine, sourceLine, signedInLine].join('|'),
  };
}

function createTrackedPlayerCard(entityId: string): TrackedPlayerCardRefs {
  const root = document.createElement('div');
  root.className = 'tracked-player';
  root.dataset.entityId = entityId;

  const head = document.createElement('div');
  head.className = 'tracked-player-head';

  const name = document.createElement('span');
  const status = document.createElement('span');
  head.append(name, status);

  const meta = document.createElement('div');
  meta.className = 'tracked-player-meta';

  const coordLine = document.createElement('div');
  const sourceLine = document.createElement('div');
  const signedInLine = document.createElement('div');
  meta.append(coordLine, sourceLine, signedInLine);

  root.append(head, meta);

  return {
    root,
    name,
    status,
    coordLine,
    sourceLine,
    signedInLine,
    signature: '',
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
