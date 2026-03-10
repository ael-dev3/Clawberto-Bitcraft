import { FIXED_REGION_ID, RUNTIME_AEL_CACHE_PATH, TRACKED_PLAYERS_CACHE_PATH, TRACKED_PLAYERS_CONFIG_PATH } from '../../config';
import { resolvePublicUrl, type WorldPoint } from '../../shared/bitcraft';
import {
  aelRuntimeCacheSchema,
  resourceSnapshotSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
  type AelRuntimeCache,
  type RuntimePlayerCache,
  type TrackedPlayerConfigItem,
} from '../../shared/schemas';
import { fetchJsonValidated } from '../fetch-json';

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
    return fetchJsonValidated(resolvePublicUrl(RUNTIME_AEL_CACHE_PATH), aelRuntimeCacheSchema, label, {
      cacheBust: true,
    });
  }

  async loadTrackedPlayersBootstrap(): Promise<TrackedPlayersBootstrap> {
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

    return {
      configRows: config ?? [],
      runtimeRows: cacheRows ?? [],
    };
  }

  async loadTrackedPlayerRuntimeRows(label: string): Promise<RuntimePlayerCache[] | null> {
    return fetchJsonValidated(resolvePublicUrl(TRACKED_PLAYERS_CACHE_PATH), trackedPlayersRuntimeCacheSchema, label, {
      cacheBust: true,
    });
  }

  async loadRequestedResourceSnapshots(resourceIds: number[]): Promise<RequestedResourceSnapshots> {
    const loaded: CachedResourcePoints[] = [];
    const missing: string[] = [];

    for (const resourceId of resourceIds) {
      const snapshot = await fetchJsonValidated(
        resolvePublicUrl(`./data/resources/${FIXED_REGION_ID}/${resourceId}.json`),
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
