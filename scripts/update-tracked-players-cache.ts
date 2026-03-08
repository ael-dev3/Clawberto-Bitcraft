import path from 'node:path';

import { DEFAULT_PLAYER } from '../src/config';
import { isFiniteNumber, regionIdFromCoord } from '../src/shared/bitcraft';
import { parseLiveStateMessage } from '../src/shared/live-state';
import {
  type PlayerDetailResponse,
  playerDetailResponseSchema,
  runtimePlayerCacheSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
  type RuntimePlayerCache,
  type TrackedPlayerConfigItem,
} from '../src/shared/schemas';
import { fetchJsonWithSchema, readJsonFileIfExists, writeJsonFile } from './lib/node-helpers';

const configPath = path.join(process.cwd(), 'public', 'data', 'tracked-players.json');
const runtimePath = path.join(process.cwd(), 'public', 'runtime', 'tracked-players.json');

const players = await readTrackedPlayerConfig();
const previousRows =
  (await readJsonFileIfExists(runtimePath, trackedPlayersRuntimeCacheSchema, 'previous tracked player runtime cache')) ?? [];
const previousById = new Map(previousRows.map((row) => [String(row.entityId), row]));

const merged = [];
for (const player of players) {
  const previous = previousById.get(player.entityId) ?? null;
  const detail = await fetchJsonWithSchema(
    `https://bitcraftmap.com/api/players/${player.entityId}`,
    playerDetailResponseSchema,
    `player detail ${player.username}`,
  );
  merged.push(buildBaselineRow(player, detail, previous));
}

const mergedById = new Map(merged.map((row) => [String(row.entityId), row]));

await new Promise<void>((resolve) => {
  const ws = new WebSocket('wss://live.bitjita.com');
  let settled = false;

  const finish = async () => {
    if (settled) return;
    settled = true;

    try {
      ws.close();
    } catch {}

    const output = trackedPlayersRuntimeCacheSchema.parse(Array.from(mergedById.values()));
    await writeJsonFile(runtimePath, output);
    console.log(`updated runtime tracked players cache (${mergedById.size} players)`);
    resolve();
  };

  ws.addEventListener('open', () => {
    const channels = players.map((player) => `mobile_entity_state:${player.entityId}`);
    ws.send(JSON.stringify({ type: 'subscribe', channels }));
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

    const current = mergedById.get(liveSnapshot.entityId);
    if (!current) return;

    mergedById.set(
      liveSnapshot.entityId,
      runtimePlayerCacheSchema.parse({
        ...current,
        x: liveSnapshot.x,
        z: liveSnapshot.z,
        regionId: liveSnapshot.regionId ?? regionIdFromCoord(liveSnapshot.x, liveSnapshot.z) ?? DEFAULT_PLAYER.defaultRegionId,
        source: 'live.bitjita.com',
        signedIn: true,
        timestamp: liveSnapshot.timestamp,
        destinationX: liveSnapshot.destinationX,
        destinationZ: liveSnapshot.destinationZ,
      } satisfies RuntimePlayerCache),
    );
  });

  ws.addEventListener('error', () => {
    void finish();
  });

  ws.addEventListener('close', () => {
    void finish();
  });

  setTimeout(() => {
    void finish();
  }, 15_000);
});

async function readTrackedPlayerConfig(): Promise<TrackedPlayerConfigItem[]> {
  const config =
    (await readJsonFileIfExists(configPath, trackedPlayerConfigSchema, 'tracked player config')) ?? [];
  return config;
}

function buildBaselineRow(
  player: TrackedPlayerConfigItem,
  detail: PlayerDetailResponse | null,
  previous: RuntimePlayerCache | null,
): RuntimePlayerCache {
  const detailPlayer = detail?.player;
  if (!detailPlayer) {
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

  if (typeof detailPlayer.locationX === 'number' && typeof detailPlayer.locationZ === 'number') {
    return runtimePlayerCacheSchema.parse({
      username: player.username,
      entityId: player.entityId,
      x: detailPlayer.locationX,
      z: detailPlayer.locationZ,
      regionId:
        detailPlayer.regionId ??
        regionIdFromCoord(detailPlayer.locationX, detailPlayer.locationZ) ??
        DEFAULT_PLAYER.defaultRegionId,
      timestamp: previous?.timestamp ?? null,
      source: 'player-detail-location',
      signedIn: detailPlayer.signedIn ?? previous?.signedIn ?? null,
      lastLoginTimestamp: detailPlayer.lastLoginTimestamp ?? previous?.lastLoginTimestamp ?? null,
      destinationX: previous?.destinationX ?? null,
      destinationZ: previous?.destinationZ ?? null,
    } satisfies RuntimePlayerCache);
  }

  if (typeof detailPlayer.teleportLocationX === 'number' && typeof detailPlayer.teleportLocationZ === 'number') {
    return runtimePlayerCacheSchema.parse({
      username: player.username,
      entityId: player.entityId,
      x: detailPlayer.teleportLocationX,
      z: detailPlayer.teleportLocationZ,
      regionId:
        detailPlayer.regionId ??
        regionIdFromCoord(detailPlayer.teleportLocationX, detailPlayer.teleportLocationZ) ??
        DEFAULT_PLAYER.defaultRegionId,
      timestamp: previous?.timestamp ?? null,
      source: 'player-detail-teleport',
      signedIn: detailPlayer.signedIn ?? previous?.signedIn ?? null,
      lastLoginTimestamp: detailPlayer.lastLoginTimestamp ?? previous?.lastLoginTimestamp ?? null,
      destinationX: previous?.destinationX ?? null,
      destinationZ: previous?.destinationZ ?? null,
    } satisfies RuntimePlayerCache);
  }

  return runtimePlayerCacheSchema.parse({
    username: player.username,
    entityId: player.entityId,
    x: previous?.x ?? null,
    z: previous?.z ?? null,
    regionId: previous?.regionId ?? null,
    timestamp: previous?.timestamp ?? null,
    source: previous?.source ?? 'unknown',
    signedIn: detailPlayer.signedIn ?? previous?.signedIn ?? null,
    lastLoginTimestamp: detailPlayer.lastLoginTimestamp ?? previous?.lastLoginTimestamp ?? null,
    destinationX: previous?.destinationX ?? null,
    destinationZ: previous?.destinationZ ?? null,
  } satisfies RuntimePlayerCache);
}
