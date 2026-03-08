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

const merged = [];
for (const player of players) {
  const resp = await fetch(`https://bitcraftmap.com/api/players/${player.entityId}`);
  const data = await resp.json();
  const detail = data.player || {};
  const prev = previousById.get(String(player.entityId)) || {};
  merged.push({
    username: player.username,
    entityId: String(player.entityId),
    x: typeof detail.teleportLocationX === 'number' ? detail.teleportLocationX : prev.x ?? null,
    z: typeof detail.teleportLocationZ === 'number' ? detail.teleportLocationZ : prev.z ?? null,
    regionId:
      typeof detail.teleportLocationX === 'number' && typeof detail.teleportLocationZ === 'number'
        ? 12
        : (prev.regionId ?? null),
    source: typeof detail.teleportLocationX === 'number' ? 'player-detail-teleport' : (prev.source || 'unknown'),
    signedIn: typeof detail.signedIn === 'boolean' ? detail.signedIn : (prev.signedIn ?? null),
    lastLoginTimestamp: detail.lastLoginTimestamp || prev.lastLoginTimestamp || null,
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
