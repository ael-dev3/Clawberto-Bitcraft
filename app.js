const MAP_SIZE = 38400;
const REGION_GRID = 5;
const REGION_SIZE = MAP_SIZE / REGION_GRID;
const APOTHEM = 2 / Math.sqrt(3);
const LIVE_WS = 'wss://live.bitjita.com';
const TERRAIN_URL = './assets/terrain/region12.png';
const RUNTIME_AEL_CACHE_URL = './runtime/ael-live.json';
const TRACKED_PLAYERS_CACHE_URL = './runtime/tracked-players.json';
const TRACKED_PLAYERS_CONFIG_URL = './data/tracked-players.json';
const RUNTIME_CACHE_REFRESH_MS = 30000;
const LIVE_FRESHNESS_SECONDS = 90;
const FIXED_REGION_ID = 12;
const DEFAULT_PLAYER = {
  username: 'Ael',
  entityId: '648518346354069088',
  defaultRegionId: FIXED_REGION_ID,
};

const params = new URLSearchParams(window.location.search);
const requestedResourceIds = parseIdList(params.get('resourceId'));
const requestedCenter = parseCenter(params.get('center'));
const requestedZoom = params.get('zoom') ? Number(params.get('zoom')) : null;

const dom = {
  status: document.getElementById('status'),
  entityId: document.getElementById('entityId'),
  coordSource: document.getElementById('coordSource'),
  coordX: document.getElementById('coordX'),
  coordZ: document.getElementById('coordZ'),
  coordRegion: document.getElementById('coordRegion'),
  coordTimestamp: document.getElementById('coordTimestamp'),
  requestedRegions: document.getElementById('requestedRegions'),
  requestedResources: document.getElementById('requestedResources'),
  resourceStatus: document.getElementById('resourceStatus'),
  diagnosticsStatus: document.getElementById('diagnosticsStatus'),
  officialLink: document.getElementById('officialLink'),
  recenterBtn: document.getElementById('recenterBtn'),
  followToggle: document.getElementById('followToggle'),
  manualX: document.getElementById('manualX'),
  manualZ: document.getElementById('manualZ'),
  manualPinBtn: document.getElementById('manualPinBtn'),
  clearManualPinBtn: document.getElementById('clearManualPinBtn'),
  trackedPlayersList: document.getElementById('trackedPlayersList'),
};

const fixedRegion = getRegionBounds(FIXED_REGION_ID);
const regionBounds = [[fixedRegion.zMin, fixedRegion.xMin], [fixedRegion.zMax, fixedRegion.xMax]];

const crs = L.extend({}, L.CRS.Simple, {
  projection: {
    project(latlng) {
      return new L.Point(latlng.lng, -latlng.lat / APOTHEM);
    },
    unproject(point) {
      return new L.LatLng(-point.y * APOTHEM, point.x);
    },
    bounds: L.bounds([0, 0], [MAP_SIZE, MAP_SIZE]),
  },
  transformation: new L.Transformation(1, 0, 1, 0),
  scale(zoom) {
    return Math.pow(2, zoom);
  },
  infinite: false,
});

const map = L.map('map', {
  crs,
  preferCanvas: true,
  zoomAnimation: false,
  attributionControl: false,
  zoomControl: true,
  boxZoom: false,
  minZoom: -2,
  maxZoom: 5,
  zoomSnap: 0.1,
  maxBounds: regionBounds,
  maxBoundsViscosity: 1,
});

const terrainLayer = L.imageOverlay(TERRAIN_URL, regionBounds, {
  crossOrigin: true,
  opacity: 1,
});
terrainLayer.addTo(map);

const regionLayer = L.layerGroup().addTo(map);
const resourceLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const playerDotLayer = L.layerGroup().addTo(map);
const playerLabelLayer = L.layerGroup().addTo(map);
const resourceRenderer = L.canvas({ padding: 0.5 });

let manualMarker = null;
let aelKnown = false;
let aelState = null;
let runtimeCache = null;
let trackedRuntimeCache = [];
let trackedPlayerConfig = [];
let terrainReady = false;
const trackedPlayers = new Map();
const playerDotMarkers = new Map();
const playerLabelMarkers = new Map();

dom.entityId.textContent = DEFAULT_PLAYER.entityId;
dom.requestedRegions.textContent = '12 (fixed build)';
dom.requestedResources.textContent = requestedResourceIds.length ? requestedResourceIds.join(', ') : 'none';
dom.officialLink.href = makeOfficialLink(requestedResourceIds);
dom.status.textContent = 'Booting';
dom.coordSource.textContent = 'none';
dom.diagnosticsStatus.textContent = 'Loading region-12 terrain + runtime cache + live feed…';

boot().catch((error) => {
  console.error(error);
  dom.status.textContent = 'Boot error';
  dom.diagnosticsStatus.textContent = `Boot error: ${error.message || String(error)}`;
  dom.diagnosticsStatus.className = 'notice warn';
});

async function boot() {
  setupButtons();
  applyInitialView();
  drawRegionFrame();
  await Promise.all([
    verifyTerrainImage(),
    loadRuntimeCache(),
    loadTrackedPlayersCache(),
    loadRequestedResourceSnapshots(),
  ]);
  connectLiveFeeds();
  startRuntimePolling();
}

function setupButtons() {
  dom.recenterBtn.addEventListener('click', () => {
    if (!aelState || !Number.isFinite(aelState.x) || !Number.isFinite(aelState.z)) return;
    map.setView([aelState.z, aelState.x], Math.max(map.getZoom(), 1.2));
  });

  dom.manualPinBtn.addEventListener('click', () => {
    const x = Number(dom.manualX.value);
    const z = Number(dom.manualZ.value);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (!isInsideFixedRegion(x, z)) {
      dom.diagnosticsStatus.textContent = 'Manual pin rejected: this build only shows region 12.';
      dom.diagnosticsStatus.className = 'notice warn';
      return;
    }
    if (manualMarker) markerLayer.removeLayer(manualMarker);
    manualMarker = L.marker([z, x], {
      icon: L.divIcon({ className: 'manual-marker', iconSize: [16, 16], iconAnchor: [8, 8] }),
    }).bindPopup(`Manual pin<br>X ${x.toFixed(3)}<br>Z ${z.toFixed(3)}<br>Region ${regionIdFromCoord(x, z) ?? 'unknown'}`);
    markerLayer.addLayer(manualMarker);
    map.setView([z, x], Math.max(map.getZoom(), 1.2));
    refreshDiagnostics();
  });

  dom.clearManualPinBtn.addEventListener('click', () => {
    if (!manualMarker) return;
    markerLayer.removeLayer(manualMarker);
    manualMarker = null;
    refreshDiagnostics();
  });
}

function applyInitialView() {
  if (requestedCenter && Number.isFinite(requestedZoom) && isInsideFixedRegion(requestedCenter.x, requestedCenter.z)) {
    map.setView([requestedCenter.z, requestedCenter.x], requestedZoom);
    return;
  }
  map.fitBounds(regionBounds, { padding: [24, 24] });
}

async function verifyTerrainImage() {
  const img = new Image();
  const loaded = await new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = TERRAIN_URL;
  });

  if (loaded) {
    terrainReady = true;
    refreshDiagnostics();
    return;
  }

  dom.diagnosticsStatus.textContent = 'Region-12 terrain image failed to load.';
  dom.diagnosticsStatus.className = 'notice warn';
}

async function loadRuntimeCache() {
  try {
    const res = await fetch(`${RUNTIME_AEL_CACHE_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      refreshDiagnostics();
      return;
    }
    runtimeCache = await res.json();
    if (Number.isFinite(runtimeCache?.x) && Number.isFinite(runtimeCache?.z)) {
      setAelPosition({
        x: runtimeCache.x,
        z: runtimeCache.z,
        regionId: runtimeCache.regionId,
        timestamp: runtimeCache.timestamp || runtimeCache.capturedAt || null,
        source: runtimeCache.source === 'player-detail-location' ? 'detail' : runtimeCache.source === 'player-detail-teleport' ? 'detail-home' : 'cached',
        recenter: false,
      });
      dom.status.textContent = 'Runtime baseline acquired';
    }
  } catch (error) {
    console.warn('Runtime cache load failed', error);
  } finally {
    refreshDiagnostics();
  }
}

async function loadTrackedPlayersCache() {
  try {
    const [configRes, cacheRes] = await Promise.all([
      fetch(`${TRACKED_PLAYERS_CONFIG_URL}?v=${Date.now()}`, { cache: 'no-store' }),
      fetch(`${TRACKED_PLAYERS_CACHE_URL}?v=${Date.now()}`, { cache: 'no-store' }),
    ]);
    trackedPlayerConfig = configRes.ok ? await configRes.json() : [];
    trackedRuntimeCache = cacheRes.ok ? await cacheRes.json() : [];

    const cacheById = new Map(trackedRuntimeCache.map((row) => [String(row.entityId), row]));
    for (const player of trackedPlayerConfig) {
      const row = cacheById.get(String(player.entityId)) || {};
      const merged = {
        ...player,
        ...row,
        source: row.source === 'player-detail-location' ? 'detail' : row.source === 'player-detail-teleport' ? 'detail-home' : row.source,
      };
      trackedPlayers.set(String(player.entityId), merged);
    }
    renderTrackedPlayers();
    fitToKnownPlayers();
  } catch (error) {
    console.warn('Tracked players cache load failed', error);
  } finally {
    refreshDiagnostics();
  }
}

function startRuntimePolling() {
  window.setInterval(() => {
    refreshAelFromRuntimeCache().catch((error) => console.warn('Ael runtime refresh failed', error));
    refreshTrackedPlayersFromRuntimeCache().catch((error) => console.warn('Tracked-player runtime refresh failed', error));
  }, RUNTIME_CACHE_REFRESH_MS);
}

function connectLiveFeeds() {
  dom.status.textContent = runtimeCache ? 'Waiting for live feed' : 'Connecting to live feed';
  const ws = new WebSocket(LIVE_WS);

  ws.addEventListener('open', () => {
    const channels = [`mobile_entity_state:${DEFAULT_PLAYER.entityId}`];
    for (const player of trackedPlayers.values()) {
      channels.push(`mobile_entity_state:${player.entityId}`);
    }
    dom.status.textContent = runtimeCache ? 'Subscribed · waiting live' : 'Subscribed';
    ws.send(JSON.stringify({ type: 'subscribe', channels }));
    refreshDiagnostics();
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'event' || !msg.data) return;
    const entityId = String(msg.data.entity_id || extractEntityId(msg.channel));
    const x = typeof msg.data.location_x === 'number' ? msg.data.location_x / 1000 : null;
    const z = typeof msg.data.location_z === 'number' ? msg.data.location_z / 1000 : null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    if (entityId === DEFAULT_PLAYER.entityId) {
      setAelPosition({
        x,
        z,
        regionId: msg.data.region_id ? Number(msg.data.region_id) : regionIdFromCoord(x, z),
        timestamp: msg.data.timestamp,
        source: 'live',
        recenter: dom.followToggle.checked,
      });
      dom.status.textContent = msg.data.is_walking ? 'Live · walking' : 'Live';
    } else if (trackedPlayers.has(entityId)) {
      updateTrackedPlayer(entityId, {
        x,
        z,
        regionId: msg.data.region_id ? Number(msg.data.region_id) : regionIdFromCoord(x, z),
        timestamp: msg.data.timestamp,
        source: 'live',
        signedIn: true,
      });
    }
    refreshDiagnostics();
  });

  ws.addEventListener('close', () => {
    if (!aelKnown) {
      dom.status.textContent = runtimeCache ? 'Live feed closed · showing cached position' : 'Live feed closed';
    }
    refreshDiagnostics();
  });

  ws.addEventListener('error', () => {
    if (!aelKnown) {
      dom.status.textContent = runtimeCache ? 'Live feed error · showing cached position' : 'Live feed error';
    }
    refreshDiagnostics();
  });
}

async function refreshAelFromRuntimeCache() {
  try {
    const res = await fetch(`${RUNTIME_AEL_CACHE_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const nextCache = await res.json();
    runtimeCache = nextCache;
    if (shouldKeepFreshLiveState(aelState)) return;
    if (!Number.isFinite(nextCache?.x) || !Number.isFinite(nextCache?.z)) return;

    setAelPosition({
      x: nextCache.x,
      z: nextCache.z,
      regionId: nextCache.regionId,
      timestamp: nextCache.timestamp || nextCache.capturedAt || null,
      source: nextCache.source === 'player-detail-location' ? 'detail' : nextCache.source === 'player-detail-teleport' ? 'detail-home' : 'cached',
      recenter: false,
    });
    dom.status.textContent = 'Runtime refresh';
  } finally {
    refreshDiagnostics();
  }
}

async function refreshTrackedPlayersFromRuntimeCache() {
  try {
    const res = await fetch(`${TRACKED_PLAYERS_CACHE_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const rows = await res.json();
    trackedRuntimeCache = rows;
    for (const row of rows) {
      const entityId = String(row.entityId);
      const current = trackedPlayers.get(entityId);
      if (!current) continue;
      if (shouldKeepFreshLiveState(current)) continue;
      updateTrackedPlayer(entityId, {
        ...current,
        ...row,
        source: row.source === 'player-detail-location' ? 'detail' : row.source === 'player-detail-teleport' ? 'detail-home' : row.source,
      });
    }
  } finally {
    refreshDiagnostics();
  }
}

function setAelPosition({ x, z, regionId, timestamp, source, recenter }) {
  aelState = {
    username: DEFAULT_PLAYER.username,
    entityId: DEFAULT_PLAYER.entityId,
    x,
    z,
    regionId: regionId ?? regionIdFromCoord(x, z),
    timestamp,
    source,
    signedIn: true,
  };

  dom.coordSource.textContent = source;
  dom.coordX.textContent = x.toFixed(3);
  dom.coordZ.textContent = z.toFixed(3);
  dom.coordRegion.textContent = String(aelState.regionId ?? 'unknown');
  dom.coordTimestamp.textContent = timestamp ? String(timestamp) : 'unknown';
  aelKnown = true;
  renderMapPlayers();

  if (aelState.regionId != null && Number(aelState.regionId) !== FIXED_REGION_ID) {
    dom.diagnosticsStatus.textContent = `Ael moved outside region 12 (now in region ${aelState.regionId}). This build stays locked to region 12.`;
    dom.diagnosticsStatus.className = 'notice warn';
    return;
  }

  if (recenter && isInsideFixedRegion(x, z)) {
    map.setView([z, x], Math.max(map.getZoom(), 1.2), { animate: false });
  }
}

function updateTrackedPlayer(entityId, patch) {
  const prev = trackedPlayers.get(String(entityId)) || { entityId: String(entityId), username: String(entityId) };
  trackedPlayers.set(String(entityId), { ...prev, ...patch });
  renderTrackedPlayers();
}

function renderTrackedPlayers() {
  renderTrackedPlayersList();
  renderMapPlayers();
}

function renderTrackedPlayersList() {
  const rows = Array.from(trackedPlayers.values()).sort((a, b) => a.username.localeCompare(b.username));
  dom.trackedPlayersList.innerHTML = '';
  for (const player of rows) {
    const onMap = Number.isFinite(player.x) && Number.isFinite(player.z) && isInsideFixedRegion(player.x, player.z) && Number(player.regionId ?? regionIdFromCoord(player.x, player.z)) === FIXED_REGION_ID;
    const card = document.createElement('div');
    card.className = 'tracked-player';
    card.innerHTML = `
      <div class="tracked-player-head">
        <span>${escapeHtml(player.username)}</span>
        <span>${onMap ? 'on map' : 'off map'}</span>
      </div>
      <div class="tracked-player-meta">
        X ${formatMaybe(player.x)} · Z ${formatMaybe(player.z)}<br>
        region ${player.regionId ?? regionIdFromCoord(player.x, player.z) ?? '—'} · source ${player.source || 'unknown'}<br>
        signed in ${player.signedIn === true ? 'yes' : player.signedIn === false ? 'no' : 'unknown'}
      </div>
    `;
    dom.trackedPlayersList.appendChild(card);
  }
}

function renderMapPlayers() {
  const rows = getRenderablePlayers();
  const labelPositions = buildLabelPositions(rows);
  const seen = new Set();

  for (const player of rows) {
    const entityId = String(player.entityId);
    seen.add(entityId);

    let dotMarker = playerDotMarkers.get(entityId);
    if (!dotMarker) {
      dotMarker = L.marker([player.z, player.x], {
        icon: L.divIcon({
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          html: '<div class="friend-marker-hitbox"><div class="friend-marker-dot"></div></div>',
        }),
      });
      playerDotMarkers.set(entityId, dotMarker);
      playerDotLayer.addLayer(dotMarker);
    }
    dotMarker.setLatLng([player.z, player.x]);
    const popupHtml = `${player.username}<br>X ${player.x.toFixed(3)}<br>Z ${player.z.toFixed(3)}<br>Region ${player.regionId ?? 'unknown'}<br>Source ${player.source || 'unknown'}`;
    dotMarker.bindPopup(popupHtml);

    const labelState = labelPositions.get(entityId) || { x: player.x, z: player.z - 120 };
    let labelMarker = playerLabelMarkers.get(entityId);
    const labelHtml = `<div class="friend-marker-label">${escapeHtml(player.username)}</div>`;
    if (!labelMarker) {
      labelMarker = L.marker([labelState.z, labelState.x], {
        interactive: true,
        keyboard: true,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          iconSize: [120, 24],
          iconAnchor: [60, 12],
          html: labelHtml,
        }),
      });
      playerLabelMarkers.set(entityId, labelMarker);
      playerLabelLayer.addLayer(labelMarker);
    }
    labelMarker.setLatLng([labelState.z, labelState.x]);
    labelMarker.setIcon(L.divIcon({
      className: '',
      iconSize: [120, 24],
      iconAnchor: [60, 12],
      html: labelHtml,
    }));
    labelMarker.bindPopup(popupHtml);
  }

  for (const [entityId, marker] of playerDotMarkers.entries()) {
    if (!seen.has(entityId)) {
      playerDotLayer.removeLayer(marker);
      playerDotMarkers.delete(entityId);
    }
  }
  for (const [entityId, marker] of playerLabelMarkers.entries()) {
    if (!seen.has(entityId)) {
      playerLabelLayer.removeLayer(marker);
      playerLabelMarkers.delete(entityId);
    }
  }
}

function getRenderablePlayers() {
  const rows = [];
  if (aelState && Number.isFinite(aelState.x) && Number.isFinite(aelState.z) && isInsideFixedRegion(aelState.x, aelState.z) && Number(aelState.regionId ?? regionIdFromCoord(aelState.x, aelState.z)) === FIXED_REGION_ID) {
    rows.push(aelState);
  }
  for (const player of trackedPlayers.values()) {
    if (Number.isFinite(player.x) && Number.isFinite(player.z) && isInsideFixedRegion(player.x, player.z) && Number(player.regionId ?? regionIdFromCoord(player.x, player.z)) === FIXED_REGION_ID) {
      rows.push(player);
    }
  }
  return rows.sort((a, b) => a.username.localeCompare(b.username));
}

function buildLabelPositions(players) {
  const groups = new Map();
  for (const player of players) {
    const key = `${player.x.toFixed(3)}:${player.z.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  const out = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.username.localeCompare(b.username));
    if (group.length === 1) {
      const p = group[0];
      out.set(String(p.entityId), { x: p.x, z: p.z - 120 });
      continue;
    }

    const useTwoColumns = group.length >= 8;
    const xOffsets = useTwoColumns ? [-78, 78] : [0];
    const baseLift = 120;
    const rowGap = 52;

    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      const column = useTwoColumns ? i % 2 : 0;
      const row = useTwoColumns ? Math.floor(i / 2) : i;
      out.set(String(p.entityId), {
        x: p.x + xOffsets[column],
        z: p.z - baseLift - row * rowGap,
      });
    }
  }
  return out;
}

function drawRegionFrame() {
  const rect = L.rectangle(regionBounds, {
    color: '#63d2ff',
    weight: 2,
    fillColor: '#63d2ff',
    fillOpacity: 0.04,
  });
  rect.bindTooltip('Region 12', { permanent: true, direction: 'center', className: 'region-label' });
  regionLayer.addLayer(rect);
}

async function loadRequestedResourceSnapshots() {
  if (!requestedResourceIds.length) {
    dom.resourceStatus.textContent = 'No region-12 resource snapshot requested.';
    return;
  }

  const loaded = [];
  const missing = [];

  for (const resourceId of requestedResourceIds) {
    const path = `./data/resources/${FIXED_REGION_ID}/${resourceId}.json`;
    try {
      const res = await fetch(path);
      if (!res.ok) {
        missing.push(`${FIXED_REGION_ID}/${resourceId}`);
        continue;
      }
      const geojson = await res.json();
      const coords = geojson?.features?.[0]?.geometry?.coordinates || [];
      for (const [x, z] of coords) {
        if (!isInsideFixedRegion(x, z)) continue;
        L.circleMarker([z, x], {
          renderer: resourceRenderer,
          radius: 2.6,
          weight: 0,
          fillOpacity: 0.65,
          fillColor: '#ffcc66',
        }).addTo(resourceLayer);
      }
      loaded.push({ regionId: FIXED_REGION_ID, resourceId, count: coords.length });
    } catch (error) {
      missing.push(`${FIXED_REGION_ID}/${resourceId}`);
    }
  }

  if (loaded.length) {
    const summary = loaded.map((x) => `resource ${x.resourceId} in region ${x.regionId}: ${x.count} points`).join(' · ');
    dom.resourceStatus.textContent = `Loaded cached region-12 snapshot: ${summary}`;
    dom.resourceStatus.className = 'notice';
  } else {
    dom.resourceStatus.textContent = 'Requested region-12 resource snapshot not cached here yet.';
    dom.resourceStatus.className = 'notice warn';
  }

  if (missing.length) {
    console.warn('Missing cached resources:', missing);
  }
}

function fitToKnownPlayers() {
  const pts = getRenderablePlayers().map((player) => [player.z, player.x]);
  if (pts.length >= 2) {
    map.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 1.2 });
  } else if (pts.length === 1) {
    map.setView(pts[0], 1.2);
  }
}

function refreshDiagnostics() {
  const parts = [];
  parts.push(terrainReady ? 'region12 terrain ok' : 'terrain pending');
  parts.push(runtimeCache ? 'ael cache ok' : 'no ael cache');
  parts.push(`${trackedPlayers.size} tracked players + Ael`);
  parts.push(aelKnown ? 'all map players rendered' : 'waiting on Ael');
  parts.push(`view z=${map.getZoom().toFixed(1)}`);
  dom.diagnosticsStatus.textContent = `Diagnostics: ${parts.join(' · ')}`;
  dom.diagnosticsStatus.className = aelKnown || terrainReady ? 'notice' : 'notice warn';
}

function shouldKeepFreshLiveState(player) {
  if (!player || player.source !== 'live') return false;
  return isFreshLiveTimestamp(player.timestamp);
}

function isFreshLiveTimestamp(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - value) <= LIVE_FRESHNESS_SECONDS;
}

function parseIdList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
}

function parseCenter(raw) {
  if (!raw) return null;
  const [x, z] = raw.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

function regionIdFromCoord(x, z) {
  if (![x, z].every(Number.isFinite)) return null;
  if (x < 0 || z < 0 || x >= MAP_SIZE || z >= MAP_SIZE) return null;
  const col = Math.floor(x / REGION_SIZE);
  const row = Math.floor(z / REGION_SIZE);
  return row * REGION_GRID + col + 1;
}

function getRegionBounds(regionId) {
  const idx = Math.max(1, Math.min(REGION_GRID * REGION_GRID, Number(regionId))) - 1;
  const row = Math.floor(idx / REGION_GRID);
  const col = idx % REGION_GRID;
  const xMin = col * REGION_SIZE;
  const xMax = xMin + REGION_SIZE;
  const zMin = row * REGION_SIZE;
  const zMax = zMin + REGION_SIZE;
  return { row, col, xMin, xMax, zMin, zMax };
}

function isInsideFixedRegion(x, z) {
  return x >= fixedRegion.xMin && x <= fixedRegion.xMax && z >= fixedRegion.zMin && z <= fixedRegion.zMax;
}

function makeOfficialLink(resourceIds) {
  const url = new URL('https://bitcraftmap.com/');
  url.searchParams.set('regionId', String(FIXED_REGION_ID));
  if (resourceIds.length) url.searchParams.set('resourceId', resourceIds.join(','));
  return url.toString();
}

function extractEntityId(channel) {
  if (!channel) return null;
  const parts = String(channel).split(':');
  return parts[parts.length - 1] || null;
}

function formatMaybe(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '—';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
