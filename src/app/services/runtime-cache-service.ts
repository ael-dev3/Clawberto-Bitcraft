import { FIXED_REGION_ID, RUNTIME_AEL_CACHE_PATH, TRACKED_PLAYERS_CACHE_PATH, TRACKED_PLAYERS_CONFIG_PATH } from '../../config';
import { type WorldPoint } from '../../shared/bitcraft';
import { fetchRuntimeJson } from '../../shared/clients/runtime';
import {
  aelRuntimeCacheSchema,
  resourceSnapshotSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
  type AelRuntimeCache,
  type RuntimePlayerCache,
  type TrackedPlayerConfigItem,
} from '../../shared/schemas';

export interface TrackedPlayersBootstrap {
  configRows: TrackedPlayerConfigItem[];
  runtimeRows: RuntimePlayerCache[];
}

export interface CachedResourcePoints {
  resourceId: number;
  points: WorldPoint[];
}

export interface RequestedResourceSnapshots {
  loaded: CachedResourcePoints[];
  missing: string[];
}

export class RuntimeCacheService {
  async loadAelCache(label: string): Promise<AelRuntimeCache | null> {
    return fetchRuntimeJson(RUNTIME_AEL_CACHE_PATH, aelRuntimeCacheSchema, label, {
      cacheBust: true,
    });
  }

  async loadTrackedPlayersBootstrap(): Promise<TrackedPlayersBootstrap> {
    const [config, cacheRows] = await Promise.all([
      fetchRuntimeJson(
        TRACKED_PLAYERS_CONFIG_PATH,
        trackedPlayerConfigSchema,
        'Tracked player config',
        { cacheBust: true },
      ),
      fetchRuntimeJson(
        TRACKED_PLAYERS_CACHE_PATH,
        trackedPlayersRuntimeCacheSchema,
        'Tracked player runtime cache',
        { cacheBust: true },
      ),
    ]);

    return {
      configRows: config ?? [],
      runtimeRows: cacheRows ?? [],
    };
  }

  async loadTrackedPlayerRuntimeRows(label: string): Promise<RuntimePlayerCache[] | null> {
    return fetchRuntimeJson(TRACKED_PLAYERS_CACHE_PATH, trackedPlayersRuntimeCacheSchema, label, {
      cacheBust: true,
    });
  }

  async loadRequestedResourceSnapshots(resourceIds: number[]): Promise<RequestedResourceSnapshots> {
    const loaded: CachedResourcePoints[] = [];
    const missing: string[] = [];

    for (const resourceId of resourceIds) {
      const snapshot = await fetchRuntimeJson(
        `./data/resources/${FIXED_REGION_ID}/${resourceId}.json`,
        resourceSnapshotSchema,
        `Resource snapshot ${resourceId}`,
      );

      if (!snapshot) {
        missing.push(`${FIXED_REGION_ID}/${resourceId}`);
        continue;
      }

      loaded.push({
        resourceId,
        points: snapshot.features.flatMap((feature) => feature.geometry.coordinates.map(([x, z]) => ({ x, z }))),
      });
    }

    return { loaded, missing };
  }
}
