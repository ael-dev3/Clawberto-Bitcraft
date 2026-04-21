import path from 'node:path';

import { DEFAULT_PLAYER } from '../src/config';
import { BITCRAFT_LIVE_SOURCE, isFiniteNumber, isInsideFixedRegion, regionIdFromCoord } from '../src/shared/bitcraft';
import { createBitcraftLiveSocket, subscribeMobileEntityState } from '../src/shared/clients/live';
import { fetchPlayerDetail, normalizePlayerDetailState } from '../src/shared/clients/player-detail';
import { parseLiveStateMessage } from '../src/shared/live-state';
import {
  runtimePlayerCacheSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
  type RuntimePlayerCache,
  type TrackedPlayerConfigItem,
} from '../src/shared/schemas';
import { readJsonFileIfExists, writeJsonFile } from './lib/node-helpers';

const configPath = path.join(process.cwd(), 'public', 'data', 'tracked-players.json');
const runtimePath = path.join(process.cwd(), 'public', 'runtime', 'tracked-players.json');

const players = await readTrackedPlayerConfig();
const previousRows =
  (await readJsonFileIfExists(runtimePath, trackedPlayersRuntimeCacheSchema, 'previous tracked player runtime cache')) ?? [];
const previousById = new Map(previousRows.map((row) => [String(row.entityId), row]));

const merged = [];
for (const player of players) {
  const previous = previousById.get(player.entityId) ?? null;
  const detail = await fetchPlayerDetail(player.entityId, `player detail ${player.username}`);
  merged.push(buildBaselineRow(player, detail, previous));
}

const mergedById = new Map(merged.map((row) => [String(row.entityId), row]));

await new Promise<void>((resolve, reject) => {
  const ws = createBitcraftLiveSocket();
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const finish = async () => {
    if (settled) return;
    settled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    try {
      ws.close();
    } catch {}

    const output = trackedPlayersRuntimeCacheSchema.parse(Array.from(mergedById.values()));
    await writeJsonFile(runtimePath, output);
    console.log(`updated runtime tracked players cache (${mergedById.size} players)`);
    resolve();
  };

  const fail = (error: unknown) => {
    if (settled) {
      return;
    }

    settled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    reject(error);
  };

  const finalize = () => {
    void finish().catch(fail);
  };

  ws.addEventListener('open', () => {
    subscribeMobileEntityState(
      ws,
      players.map((player) => player.entityId),
    );
  });

  ws.addEventListener('message', (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data) as unknown;
    } catch (error) {
      console.warn('invalid websocket payload', error);
      return;
    }

    const liveSnapshot = parseLiveStateMessage(parsed, 'Tracked player runtime websocket payload');
    if (!liveSnapshot?.entityId || !isFiniteNumber(liveSnapshot.x) || !isFiniteNumber(liveSnapshot.z)) {
      return;
    }

    if (!isInsideFixedRegion({ x: liveSnapshot.x, z: liveSnapshot.z })) {
      return;
    }

    const current = mergedById.get(liveSnapshot.entityId);
    if (!current) return;

    mergedById.set(
      liveSnapshot.entityId,
      runtimePlayerCacheSchema.parse({
        ...current,
        x: liveSnapshot.x,
        z: liveSnapshot.z,
        regionId: liveSnapshot.regionId ?? regionIdFromCoord(liveSnapshot.x, liveSnapshot.z) ?? DEFAULT_PLAYER.defaultRegionId,
        source: BITCRAFT_LIVE_SOURCE,
        signedIn: true,
        timestamp: liveSnapshot.timestamp,
        destinationX: liveSnapshot.destinationX,
        destinationZ: liveSnapshot.destinationZ,
      } satisfies RuntimePlayerCache),
    );
  });

  ws.addEventListener('error', () => {
    finalize();
  });

  ws.addEventListener('close', () => {
    finalize();
  });

  timeoutId = setTimeout(() => {
    finalize();
  }, 15_000);
});

async function readTrackedPlayerConfig(): Promise<TrackedPlayerConfigItem[]> {
  const config =
    (await readJsonFileIfExists(configPath, trackedPlayerConfigSchema, 'tracked player config')) ?? [];
  return config;
}

function buildBaselineRow(
  player: TrackedPlayerConfigItem,
  detail: Awaited<ReturnType<typeof fetchPlayerDetail>>,
  previous: RuntimePlayerCache | null,
): RuntimePlayerCache {
  const normalized = normalizePlayerDetailState(detail, DEFAULT_PLAYER.defaultRegionId);
  if (!normalized) {
    return runtimePlayerCacheSchema.parse({
      username: player.username,
      entityId: player.entityId,
      x: previous?.x ?? null,
      z: previous?.z ?? null,
      regionId: previous?.regionId ?? null,
      timestamp: previous?.timestamp ?? null,
      source: previous?.source ?? 'unknown',
      signedIn: previous?.signedIn ?? null,
      lastLoginTimestamp: previous?.lastLoginTimestamp ?? null,
      destinationX: previous?.destinationX ?? null,
      destinationZ: previous?.destinationZ ?? null,
    } satisfies RuntimePlayerCache);
  }

  return runtimePlayerCacheSchema.parse({
    username: player.username,
    entityId: player.entityId,
    x: normalized.x,
    z: normalized.z,
    regionId: normalized.regionId,
    timestamp: previous?.timestamp ?? null,
    source: normalized.source,
    signedIn: normalized.signedIn ?? previous?.signedIn ?? null,
    lastLoginTimestamp: normalized.lastLoginTimestamp ?? previous?.lastLoginTimestamp ?? null,
    destinationX: previous?.destinationX ?? null,
    destinationZ: previous?.destinationZ ?? null,
  } satisfies RuntimePlayerCache);
}
