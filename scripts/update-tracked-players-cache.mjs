import fs from 'node:fs/promises';
import path from 'node:path';

const configPath = path.join(process.cwd(), 'data', 'tracked-players.json');
const runtimePath = path.join(process.cwd(), 'runtime', 'tracked-players.json');
const players = JSON.parse(await fs.readFile(configPath, 'utf8'));

let previous = [];
try {
  previous = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
} catch {}
const previousById = new Map(previous.map((row) => [String(row.entityId), row]));

function extractDetailBaseline(detail, prev = {}) {
  const player = detail?.player || null;
  if (!player) return {
    x: prev.x ?? null,
    z: prev.z ?? null,
    regionId: prev.regionId ?? null,
    source: prev.source || 'unknown',
  };

  if (typeof player.locationX === 'number' && typeof player.locationZ === 'number') {
    return {
      x: player.locationX,
      z: player.locationZ,
      regionId: typeof player.regionId === 'number' ? player.regionId : (prev.regionId ?? 12),
      source: 'player-detail-location',
    };
  }

  if (typeof player.teleportLocationX === 'number' && typeof player.teleportLocationZ === 'number') {
    return {
      x: player.teleportLocationX,
      z: player.teleportLocationZ,
      regionId: prev.regionId ?? 12,
      source: 'player-detail-teleport',
    };
  }

  return {
    x: prev.x ?? null,
    z: prev.z ?? null,
    regionId: prev.regionId ?? null,
    source: prev.source || 'unknown',
  };
}

const merged = [];
for (const player of players) {
  const prev = previousById.get(String(player.entityId)) || {};
  let detail = null;
  try {
    const resp = await fetch(`https://bitcraftmap.com/api/players/${player.entityId}`);
    const text = await resp.text();
    if (resp.ok && text.trim().startsWith('{')) {
      detail = JSON.parse(text);
    } else {
      console.warn(`player detail fallback for ${player.username}: non-json or non-ok response`);
    }
  } catch (error) {
    console.warn(`player detail fallback for ${player.username}: ${error.message}`);
  }

  const baseline = extractDetailBaseline(detail, prev);
  const playerDetail = detail?.player || null;

  merged.push({
    username: player.username,
    entityId: String(player.entityId),
    x: baseline.x,
    z: baseline.z,
    regionId: baseline.regionId,
    source: baseline.source,
    signedIn: typeof playerDetail?.signedIn === 'boolean' ? playerDetail.signedIn : (prev.signedIn ?? null),
    lastLoginTimestamp: playerDetail?.lastLoginTimestamp || prev.lastLoginTimestamp || null,
  });
}

const mergedById = new Map(merged.map((row) => [String(row.entityId), row]));

await new Promise((resolve) => {
  const ws = new WebSocket('wss://live.bitjita.com');
  let settled = false;
  const done = async () => {
    if (settled) return;
    settled = true;
    try { ws.close(); } catch {}
    await fs.writeFile(runtimePath, JSON.stringify(Array.from(mergedById.values()), null, 2) + '\n');
    console.log(`updated runtime tracked players cache (${mergedById.size} players)`);
    resolve();
  };

  ws.addEventListener('open', () => {
    const channels = players.map((player) => `mobile_entity_state:${player.entityId}`);
    ws.send(JSON.stringify({ type: 'subscribe', channels }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'event' || !msg.data) return;
    const entityId = String(msg.data.entity_id || String(msg.channel || '').split(':').pop());
    if (!mergedById.has(entityId)) return;
    if (typeof msg.data.location_x !== 'number' || typeof msg.data.location_z !== 'number') return;
    const prev = mergedById.get(entityId);
    mergedById.set(entityId, {
      ...prev,
      x: msg.data.location_x / 1000,
      z: msg.data.location_z / 1000,
      regionId: msg.data.region_id ? Number(msg.data.region_id) : (prev.regionId ?? 12),
      source: 'live.bitjita.com',
      signedIn: true,
      timestamp: msg.data.timestamp ?? null,
    });
  });

  ws.addEventListener('error', done);
  ws.addEventListener('close', done);
  setTimeout(done, 15000);
});
