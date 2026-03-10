import { DEFAULT_PLAYER, FIXED_REGION_ID, RUNTIME_CACHE_REFRESH_MS } from '../../config';
import { isInsideFixedRegion } from '../../shared/bitcraft';
import type { AelRuntimeCache } from '../../shared/schemas';
import type { AppDom } from '../../ui/dom';
import { MapController } from '../map-controller';
import { PlayerStore } from '../store/player-store';
import type { QueryState } from '../types';
import { AppPresenter } from './app-presenter';
import { LiveFeedService, type LiveFeedConnection } from './live-feed-service';
import { RuntimeCacheService } from './runtime-cache-service';

export interface AppControllerOptions {
  dom: AppDom;
  mapController: MapController;
  queryState: QueryState;
}

export class AppController {
  private readonly presenter: AppPresenter;
  private readonly runtimeCacheService = new RuntimeCacheService();
  private readonly liveFeedService = new LiveFeedService();
  private readonly playerStore = new PlayerStore();

  private runtimeCache: AelRuntimeCache | null = null;
  private terrainReady = false;
  private runtimePollingAbortController: AbortController | null = null;
  private liveFeedConnection: LiveFeedConnection | null = null;

  constructor(
    private readonly options: AppControllerOptions,
  ) {
    this.presenter = new AppPresenter(options.dom);
    this.presenter.initializeStaticUi(options.queryState);
  }

  async boot(): Promise<void> {
    this.setupButtons();
    this.options.mapController.applyInitialView(this.options.queryState.requestedCenter, this.options.queryState.requestedZoom);
    this.options.mapController.drawRegionFrame();

    await Promise.all([
      this.verifyTerrain(),
      this.loadRuntimeBaseline(),
      this.loadTrackedPlayersCache(),
      this.loadRequestedResourceSnapshots(),
    ]);

    this.connectLiveFeeds();
    this.startRuntimePolling();
  }

  handleBootError(error: unknown): void {
    this.presenter.handleBootError(error);
  }

  dispose(): void {
    this.runtimePollingAbortController?.abort();
    this.runtimePollingAbortController = null;

    this.liveFeedConnection?.dispose();
    this.liveFeedConnection = null;
  }

  private setupButtons(): void {
    this.presenter.bindRecenter(() => {
      const point = this.playerStore.getKnownAelPoint();
      if (!point) {
        return;
      }

      this.options.mapController.recenter(point);
    });

    this.presenter.bindManualPin(() => {
      const point = this.presenter.readManualPoint();
      if (!point) {
        return;
      }

      if (!isInsideFixedRegion(point)) {
        this.presenter.showManualPinRejected();
        return;
      }

      this.options.mapController.setManualPin(point);
      this.options.mapController.recenter(point);
      this.refreshDiagnostics();
    });

    this.presenter.bindClearManualPin(() => {
      this.options.mapController.clearManualPin();
      this.refreshDiagnostics();
    });
  }

  private async verifyTerrain(): Promise<void> {
    const loaded = await this.options.mapController.verifyTerrainImage();
    if (!loaded) {
      this.presenter.showTerrainLoadFailed();
      return;
    }

    this.terrainReady = true;
    this.refreshDiagnostics();
  }

  private async loadRuntimeBaseline(): Promise<void> {
    try {
      const cache = await this.runtimeCacheService.loadAelCache('Ael runtime cache');
      this.runtimeCache = cache;
      if (!this.playerStore.hydrateAelFromRuntimeCache(cache, false)) {
        return;
      }

      this.handleAelStateUpdated();
      this.presenter.setStatus('Runtime baseline acquired');
    } catch (error) {
      console.warn('Runtime cache load failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private async loadTrackedPlayersCache(): Promise<void> {
    try {
      const { configRows, runtimeRows } = await this.runtimeCacheService.loadTrackedPlayersBootstrap();
      this.playerStore.hydrateTrackedPlayers(configRows, runtimeRows);
      this.syncTrackedPlayerViews();
      this.fitToKnownPlayers();
    } catch (error) {
      console.warn('Tracked players cache load failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private async loadRequestedResourceSnapshots(): Promise<void> {
    const { requestedResourceIds } = this.options.queryState;
    if (requestedResourceIds.length === 0) {
      this.presenter.showNoRequestedResources();
      return;
    }

    const snapshotResult = await this.runtimeCacheService.loadRequestedResourceSnapshots(requestedResourceIds);
    const loaded = snapshotResult.loaded.map((item) => ({
      resourceId: item.resourceId,
      count: this.options.mapController.addResourcePoints(item.points),
    }));

    if (loaded.length > 0) {
      this.presenter.showRequestedResourcesLoaded(loaded);
    } else {
      this.presenter.showRequestedResourcesMissing();
    }

    if (snapshotResult.missing.length > 0) {
      console.warn('Missing cached resources', snapshotResult.missing);
    }
  }

  private startRuntimePolling(): void {
    this.runtimePollingAbortController?.abort();

    const abortController = new AbortController();
    this.runtimePollingAbortController = abortController;
    void this.runRuntimePollingLoop(abortController.signal);
  }

  private connectLiveFeeds(): void {
    this.presenter.setStatus(this.runtimeCache ? 'Waiting for live feed' : 'Connecting to live feed');

    this.liveFeedConnection?.dispose();
    this.liveFeedConnection = this.liveFeedService.connect([DEFAULT_PLAYER.entityId, ...this.playerStore.getTrackedPlayerEntityIds()], {
      onOpen: () => {
        this.presenter.setStatus(this.runtimeCache ? 'Subscribed · waiting live' : 'Subscribed');
        this.refreshDiagnostics();
      },
      onLiveState: (liveState) => {
        const outcome = this.playerStore.applyLiveSnapshot(liveState);
        if (!outcome.accepted) {
          if (outcome.reason === 'off-map') {
            console.warn('Ignoring off-map live update for fixed region-12 build', liveState);
          } else if (outcome.reason === 'pending') {
            console.warn('Holding suspicious live update pending confirmation', liveState);
          }
          return;
        }

        if (outcome.kind === 'ael') {
          this.handleAelStateUpdated();
          this.presenter.setStatus(outcome.isWalking ? 'Live · walking' : 'Live');
        } else if (outcome.kind === 'tracked') {
          this.syncTrackedPlayerViews();
        }

        this.refreshDiagnostics();
      },
      onClose: () => {
        if (!this.playerStore.isAelKnown()) {
          this.presenter.setStatus(this.runtimeCache ? 'Live feed closed · showing cached position' : 'Live feed closed');
        }
        this.refreshDiagnostics();
      },
      onError: () => {
        if (!this.playerStore.isAelKnown()) {
          this.presenter.setStatus(this.runtimeCache ? 'Live feed error · showing cached position' : 'Live feed error');
        }
        this.refreshDiagnostics();
      },
    });
  }

  private async runRuntimePollingLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await waitForAbortableDelay(RUNTIME_CACHE_REFRESH_MS, signal);
      if (signal.aborted) {
        return;
      }

      await Promise.all([this.refreshAelFromRuntimeCache(), this.refreshTrackedPlayersFromRuntimeCache()]);
    }
  }

  private async refreshAelFromRuntimeCache(): Promise<void> {
    try {
      const cache = await this.runtimeCacheService.loadAelCache('Ael runtime cache refresh');
      this.runtimeCache = cache;
      if (!this.playerStore.hydrateAelFromRuntimeCache(cache, true)) {
        return;
      }

      this.handleAelStateUpdated();
      this.presenter.setStatus('Runtime refresh');
    } catch (error) {
      console.warn('Ael runtime refresh failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private async refreshTrackedPlayersFromRuntimeCache(): Promise<void> {
    try {
      const rows = await this.runtimeCacheService.loadTrackedPlayerRuntimeRows('Tracked player runtime refresh');
      if (!rows || !this.playerStore.refreshTrackedPlayersFromRuntimeRows(rows)) {
        return;
      }

      this.syncTrackedPlayerViews();
    } catch (error) {
      console.warn('Tracked-player runtime refresh failed', error);
    } finally {
      this.refreshDiagnostics();
    }
  }

  private handleAelStateUpdated(): void {
    const aelState = this.playerStore.getAelState();
    if (!aelState) {
      return;
    }

    this.presenter.renderAelPosition(aelState);
    this.options.mapController.renderPlayers(this.playerStore.getRenderablePlayers());

    if (aelState.regionId != null && aelState.regionId !== FIXED_REGION_ID) {
      this.presenter.showAelMovedOutsideRegion(aelState.regionId);
      return;
    }

    const point = this.playerStore.getKnownAelPoint();
    if (point && this.presenter.shouldFollowPlayer() && isInsideFixedRegion(point)) {
      this.options.mapController.recenter(point);
    }
  }

  private syncTrackedPlayerViews(): void {
    this.presenter.renderTrackedPlayers(this.playerStore.getTrackedPlayers());
    this.options.mapController.renderPlayers(this.playerStore.getRenderablePlayers());
  }

  private fitToKnownPlayers(): void {
    this.options.mapController.fitToPlayers(this.playerStore.getRenderablePlayers());
  }

  private refreshDiagnostics(): void {
    this.presenter.refreshDiagnostics({
      terrainReady: this.terrainReady,
      hasRuntimeCache: this.runtimeCache != null,
      trackedPlayerCount: this.playerStore.getTrackedPlayerCount(),
      aelKnown: this.playerStore.isAelKnown(),
      zoom: this.options.mapController.getZoom(),
    });
  }
}

function waitForAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
