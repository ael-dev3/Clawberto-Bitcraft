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

export class AppPresenter {
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
