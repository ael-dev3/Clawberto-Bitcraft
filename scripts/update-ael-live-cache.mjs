import fs from 'node:fs/promises';
import path from 'node:path';

const entityId = process.argv[2] || '648518346354069088';
const username = process.argv[3] || 'Ael';
const outPath = path.join(process.cwd(), 'runtime', 'ael-live.json');
const detailUrl = `https://bitcraftmap.com/api/players/${entityId}`;

let previous = null;
try {
  previous = JSON.parse(await fs.readFile(outPath, 'utf8'));
} catch {}

function save(payload) {
  return fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');
}

function extractDetailBaseline(detail) {
  const player = detail?.player || null;
  if (!player) return null;

  if (typeof player.locationX === 'number' && typeof player.locationZ === 'number') {
    return {
      username,
      entityId,
      x: player.locationX,
      z: player.locationZ,
      regionId: typeof player.regionId === 'number' ? player.regionId : 12,
      timestamp: null,
      capturedAt: new Date().toISOString(),
      source: 'player-detail-location',
      signedIn: typeof player.signedIn === 'boolean' ? player.signedIn : null,
      lastLoginTimestamp: player.lastLoginTimestamp || null,
    };
  }

  if (typeof player.teleportLocationX === 'number' && typeof player.teleportLocationZ === 'number') {
    return {
      username,
      entityId,
      x: player.teleportLocationX,
      z: player.teleportLocationZ,
      regionId: 12,
      timestamp: null,
      capturedAt: new Date().toISOString(),
      source: 'player-detail-teleport',
      signedIn: typeof player.signedIn === 'boolean' ? player.signedIn : null,
      lastLoginTimestamp: player.lastLoginTimestamp || null,
    };
  }

  return null;
}

let detailBaseline = null;
try {
  const resp = await fetch(detailUrl);
  const text = await resp.text();
  if (resp.ok && text.trim().startsWith('{')) {
    detailBaseline = extractDetailBaseline(JSON.parse(text));
  }
} catch {}

const ws = new WebSocket('wss://live.bitjita.com');
let latest = null;
let settled = false;

const done = async (reason) => {
  if (settled) return;
  settled = true;
  try { ws.close(); } catch {}

  if (latest) {
    const payload = {
      username,
      entityId,
      x: latest.location_x / 1000,
      z: latest.location_z / 1000,
      regionId: Number(latest.region_id),
      timestamp: latest.timestamp,
      capturedAt: new Date().toISOString(),
      source: 'live.bitjita.com',
      destinationX: typeof latest.destination_x === 'number' ? latest.destination_x / 1000 : null,
      destinationZ: typeof latest.destination_z === 'number' ? latest.destination_z / 1000 : null,
    };
    await save(payload);
    console.log(`updated runtime cache from live websocket (${reason})`);
    return;
  }

  if (detailBaseline) {
    await save(detailBaseline);
    console.log(`updated runtime cache from player detail (${reason})`);
    return;
  }

  if (previous) {
    const baseSource = String(previous.source || 'unknown').split(';')[0];
    const payload = {
      ...previous,
      retainedAt: new Date().toISOString(),
      source: `${baseSource}; retained-no-fresh-event`,
    };
    await save(payload);
    console.log(`retained previous runtime cache (${reason})`);
    return;
  }

  throw new Error(`No live event captured, no player detail, and no previous cache to retain (${reason})`);
};

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: [`mobile_entity_state:${entityId}`] }));
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'event' && msg.data && typeof msg.data.location_x === 'number' && typeof msg.data.location_z === 'number') {
    latest = msg.data;
  }
});

ws.addEventListener('error', async () => {
  await done('error');
});

ws.addEventListener('close', async () => {
  await done('close');
});

setTimeout(async () => {
  await done('timeout');
}, 15000);
