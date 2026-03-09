import path from 'node:path';

import { DEFAULT_PLAYER } from '../src/config';
import { isFiniteNumber, isInsideFixedRegion, regionIdFromCoord } from '../src/shared/bitcraft';
import { parseLiveStateMessage, type LiveStateSnapshot } from '../src/shared/live-state';
import {
  aelRuntimeCacheSchema,
  playerDetailResponseSchema,
  type AelRuntimeCache,
  type PlayerDetailResponse,
} from '../src/shared/schemas';
import { decideLiveUpdateTrust, type PendingLiveCandidate } from '../src/app/live-trust';
import type { PlayerRecord } from '../src/app/types';
import { fetchJsonWithSchema, readJsonFileIfExists, writeJsonFile } from './lib/node-helpers';

const entityId = process.argv[2] || DEFAULT_PLAYER.entityId;
const username = process.argv[3] || DEFAULT_PLAYER.username;
const outputPath = path.join(process.cwd(), 'public', 'runtime', 'ael-live.json');
const detailUrl = `https://bitcraftmap.com/api/players/${entityId}`;

const previous = await readJsonFileIfExists(outputPath, aelRuntimeCacheSchema, 'previous Ael runtime cache');
const detailResponse = await fetchJsonWithSchema(detailUrl, playerDetailResponseSchema, `player detail ${entityId}`);
const detailBaseline = extractDetailBaseline(detailResponse);

const ws = new WebSocket('wss://live.bitjita.com');
let latestLiveSnapshot: LiveStateSnapshot | null = null;
let pendingCandidate: PendingLiveCandidate | null = null;
let settled = false;

const finish = async (reason: string) => {
  if (settled) return;
  settled = true;

  try {
    ws.close();
  } catch {}

  if (latestLiveSnapshot && isFiniteNumber(latestLiveSnapshot.x) && isFiniteNumber(latestLiveSnapshot.z)) {
    const payload = aelRuntimeCacheSchema.parse({
      username,
      entityId,
      x: latestLiveSnapshot.x,
      z: latestLiveSnapshot.z,
      regionId: latestLiveSnapshot.regionId ?? regionIdFromCoord(latestLiveSnapshot.x, latestLiveSnapshot.z),
      timestamp: latestLiveSnapshot.timestamp,
      capturedAt: new Date().toISOString(),
      source: 'live.bitjita.com',
      destinationX: latestLiveSnapshot.destinationX,
      destinationZ: latestLiveSnapshot.destinationZ,
      signedIn: true,
    } satisfies AelRuntimeCache);

    await writeJsonFile(outputPath, payload);
    console.log(`updated runtime cache from live websocket (${reason})`);
    return;
  }

  if (detailBaseline) {
    await writeJsonFile(outputPath, detailBaseline);
    console.log(`updated runtime cache from player detail (${reason})`);
    return;
  }

  if (previous) {
    const baseSource = String(previous.source || 'unknown').split(';')[0] || 'unknown';
    const retainedPayload = aelRuntimeCacheSchema.parse({
      ...previous,
      retainedAt: new Date().toISOString(),
      source: `${baseSource}; retained-no-fresh-event`,
    } satisfies AelRuntimeCache);

    await writeJsonFile(outputPath, retainedPayload);
    console.log(`retained previous runtime cache (${reason})`);
    return;
  }

  throw new Error(`No live event captured, no player detail, and no previous cache to retain (${reason})`);
};

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: [`mobile_entity_state:${entityId}`] }));
});

ws.addEventListener('message', (event) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data) as unknown;
  } catch (error) {
    console.warn('invalid websocket payload', error);
    return;
  }

  const liveSnapshot = parseLiveStateMessage(parsed, 'Ael runtime websocket payload');
  if (!liveSnapshot || !isFiniteNumber(liveSnapshot.x) || !isFiniteNumber(liveSnapshot.z)) {
    return;
  }

  if (!isInsideFixedRegion({ x: liveSnapshot.x, z: liveSnapshot.z })) {
    return;
  }

  const trustDecision = decideLiveUpdateTrust(
    entityId,
    toPlayerRecord(latestLiveSnapshot) ?? toPlayerRecord(detailBaseline) ?? toPlayerRecord(previous),
    liveSnapshot,
    pendingCandidate,
  );
  pendingCandidate = trustDecision.nextPending;
  if (!trustDecision.accept) {
    return;
  }

  latestLiveSnapshot = liveSnapshot;
});

ws.addEventListener('error', async () => {
  await finish('error');
});

ws.addEventListener('close', async () => {
  await finish('close');
});

setTimeout(async () => {
  await finish('timeout');
}, 15_000);

function toPlayerRecord(snapshot: LiveStateSnapshot | AelRuntimeCache | null): PlayerRecord | null {
  if (!snapshot || !isFiniteNumber(snapshot.x) || !isFiniteNumber(snapshot.z)) {
    return null;
  }

  const source = 'source' in snapshot ? snapshot.source ?? 'unknown' : 'live';
  const signedIn = 'signedIn' in snapshot ? snapshot.signedIn ?? true : true;
  const lastLoginTimestamp = 'lastLoginTimestamp' in snapshot ? snapshot.lastLoginTimestamp ?? null : null;

  return {
    username,
    entityId,
    x: snapshot.x,
    z: snapshot.z,
    regionId: snapshot.regionId ?? regionIdFromCoord(snapshot.x, snapshot.z),
    timestamp: snapshot.timestamp ?? null,
    source,
    signedIn,
    lastLoginTimestamp,
    destinationX: snapshot.destinationX ?? null,
    destinationZ: snapshot.destinationZ ?? null,
  };
}

function extractDetailBaseline(detail: PlayerDetailResponse | null): AelRuntimeCache | null {
  const player = detail?.player;
  if (!player) return null;

  if (typeof player.locationX === 'number' && typeof player.locationZ === 'number') {
    return aelRuntimeCacheSchema.parse({
      username,
      entityId,
      x: player.locationX,
      z: player.locationZ,
      regionId: player.regionId ?? regionIdFromCoord(player.locationX, player.locationZ) ?? DEFAULT_PLAYER.defaultRegionId,
      timestamp: null,
      capturedAt: new Date().toISOString(),
      source: 'player-detail-location',
      signedIn: player.signedIn ?? null,
      lastLoginTimestamp: player.lastLoginTimestamp ?? null,
    } satisfies AelRuntimeCache);
  }

  if (typeof player.teleportLocationX === 'number' && typeof player.teleportLocationZ === 'number') {
    return aelRuntimeCacheSchema.parse({
      username,
      entityId,
      x: player.teleportLocationX,
      z: player.teleportLocationZ,
      regionId:
        player.regionId ??
        regionIdFromCoord(player.teleportLocationX, player.teleportLocationZ) ??
        DEFAULT_PLAYER.defaultRegionId,
      timestamp: null,
      capturedAt: new Date().toISOString(),
      source: 'player-detail-teleport',
      signedIn: player.signedIn ?? null,
      lastLoginTimestamp: player.lastLoginTimestamp ?? null,
    } satisfies AelRuntimeCache);
  }

  return null;
}
