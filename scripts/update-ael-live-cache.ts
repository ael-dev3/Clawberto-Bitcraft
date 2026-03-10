import path from 'node:path';

import { DEFAULT_PLAYER } from '../src/config';
import { BITCRAFT_LIVE_SOURCE, isFiniteNumber, isInsideFixedRegion, regionIdFromCoord } from '../src/shared/bitcraft';
import { createBitcraftLiveSocket, subscribeMobileEntityState } from '../src/shared/clients/live';
import { fetchPlayerDetail, normalizePlayerDetailState } from '../src/shared/clients/player-detail';
import { parseLiveStateMessage, type LiveStateSnapshot } from '../src/shared/live-state';
import {
  aelRuntimeCacheSchema,
  type AelRuntimeCache,
} from '../src/shared/schemas';
import { decideLiveUpdateTrust, type PendingLiveCandidate } from '../src/app/live-trust';
import type { PlayerRecord } from '../src/app/types';
import { readJsonFileIfExists, writeJsonFile } from './lib/node-helpers';

const entityId = process.argv[2] || DEFAULT_PLAYER.entityId;
const username = process.argv[3] || DEFAULT_PLAYER.username;
const outputPath = path.join(process.cwd(), 'public', 'runtime', 'ael-live.json');

const previous = await readJsonFileIfExists(outputPath, aelRuntimeCacheSchema, 'previous Ael runtime cache');
const detailResponse = await fetchPlayerDetail(entityId, `player detail ${entityId}`);
const detailBaseline = extractDetailBaseline(detailResponse);

const ws = createBitcraftLiveSocket();
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
      source: BITCRAFT_LIVE_SOURCE,
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
  subscribeMobileEntityState(ws, [entityId]);
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

function extractDetailBaseline(detail: Awaited<ReturnType<typeof fetchPlayerDetail>>): AelRuntimeCache | null {
  const normalized = normalizePlayerDetailState(detail, DEFAULT_PLAYER.defaultRegionId);
  if (!normalized) {
    return null;
  }

  return aelRuntimeCacheSchema.parse({
    username,
    entityId,
    x: normalized.x,
    z: normalized.z,
    regionId: normalized.regionId,
    timestamp: null,
    capturedAt: new Date().toISOString(),
    source: normalized.source,
    signedIn: normalized.signedIn,
    lastLoginTimestamp: normalized.lastLoginTimestamp,
  } satisfies AelRuntimeCache);
}
