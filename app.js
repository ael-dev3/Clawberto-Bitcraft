const MAP_SIZE = 38400;
const REGION_GRID = 5;
const REGION_SIZE = MAP_SIZE / REGION_GRID; // 7680
const APOTHEM = 2 / Math.sqrt(3);
const EXPORTS_CDN = 'https://exports.bitjita.com';
const LIVE_WS = 'wss://live.bitjita.com';
const DEFAULT_PLAYER = {
  username: 'Ael',
  entityId: '648518346354069088',
};

const params = new URLSearchParams(window.location.search);
const requestedRegionIds = parseIdList(params.get('regionId'));
const requestedResourceIds = parseIdList(params.get('resourceId'));
const requestedCenter = parseCenter(params.get('center'));
const requestedZoom = params.get('zoom') ? Number(params.get('zoom')) : null;

const dom = {
  status: document.getElementById('status'),
  entityId: document.getElementById('entityId'),
  coordX: document.getElementById('coordX'),
  coordZ: document.getElementById('coordZ'),
  coordRegion: document.getElementById('coordRegion'),
  coordTimestamp: document.getElementById('coordTimestamp'),
  requestedRegions: document.getElementById('requestedRegions'),
  requestedResources: document.getElementById('requestedResources'),
  resourceStatus: document.getElementById('resourceStatus'),
  officialLink: document.getElementById('officialLink'),
  recenterBtn: document.getElementById('recenterBtn'),
  followToggle: document.getElementById('followToggle'),
  manualX: document.getElementById('manualX'),
  manualZ: document.getElementById('manualZ'),
  manualPinBtn: document.getElementById('manualPinBtn'),
  clearManualPinBtn: document.getElementById('clearManualPinBtn'),
};

dom.entityId.textContent = DEFAULT_PLAYER.entityId;
dom.requestedRegions.textContent = requestedRegionIds.length ? requestedRegionIds.join(', ') : 'none';
dom.requestedResources.textContent = requestedResourceIds.length ? requestedResourceIds.join(', ') : 'none';
dom.officialLink.href = makeOfficialLink(requestedRegionIds, requestedResourceIds);

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
  minZoom: -5,
  maxZoom: 5,
  zoomSnap: 0.1,
});

const bounds = [[0, 0], [MAP_SIZE, MAP_SIZE]];
const baseLayer = L.imageOverlay('https://bitcraftmap.com/assets/maps/map.webp', bounds, {
  crossOrigin: true,
  opacity: 1,
});
baseLayer.addTo(map);

const regionLayer = L.layerGroup().addTo(map);
const resourceLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const resourceRenderer = L.canvas({ padding: 0.5 });

const aelMarker = L.marker([0, 0], {
  icon: L.divIcon({ className: 'ael-marker', iconSize: [18, 18], iconAnchor: [9, 9] }),
});
let manualMarker = null;
let aelKnown = false;

function initialView() {
  if (requestedCenter && Number.isFinite(requestedZoom)) {
    map.setView([requestedCenter.z, requestedCenter.x], requestedZoom);
    return;
  }
  if (requestedRegionIds.length) {
    const first = getRegionBounds(requestedRegionIds[0]);
    map.fitBounds([[first.zMin, first.xMin], [first.zMax, first.xMax]], { padding: [32, 32] });
    return;
  }
  map.fitBounds(bounds);
}

initialView();

dom.recenterBtn.addEventListener('click', () => {
  if (!aelKnown) return;
  const ll = aelMarker.getLatLng();
  map.setView(ll, Math.max(map.getZoom(), 0.5));
});

dom.manualPinBtn.addEventListener('click', () => {
  const x = Number(dom.manualX.value);
  const z = Number(dom.manualZ.value);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (manualMarker) markerLayer.removeLayer(manualMarker);
  manualMarker = L.marker([z, x], {
    icon: L.divIcon({ className: 'manual-marker', iconSize: [16, 16], iconAnchor: [8, 8] }),
  }).bindPopup(`Manual pin<br>X ${x.toFixed(3)}<br>Z ${z.toFixed(3)}<br>Region ${regionIdFromCoord(x, z) ?? 'unknown'}`);
  markerLayer.addLayer(manualMarker);
  map.setView([z, x], Math.max(map.getZoom(), 0.5));
});

dom.clearManualPinBtn.addEventListener('click', () => {
  if (!manualMarker) return;
  markerLayer.removeLayer(manualMarker);
  manualMarker = null;
});

function drawRequestedRegions() {
  const regions = requestedRegionIds.length ? requestedRegionIds : [12];
  for (const regionId of regions) {
    const r = getRegionBounds(regionId);
    const rect = L.rectangle([[r.zMin, r.xMin], [r.zMax, r.xMax]], {
      color: regionId === 12 ? '#63d2ff' : '#7cff9e',
      weight: 2,
      fillColor: regionId === 12 ? '#63d2ff' : '#7cff9e',
      fillOpacity: 0.06,
    });
    rect.bindTooltip(`Region ${regionId}`, { permanent: true, direction: 'center', className: 'region-label' });
    regionLayer.addLayer(rect);
  }
}

drawRequestedRegions();
loadRequestedResourceSnapshots();
connectAelFeed();

async function loadRequestedResourceSnapshots() {
  if (!requestedRegionIds.length || !requestedResourceIds.length) {
    return;
  }

  const loaded = [];
  const missing = [];

  for (const regionId of requestedRegionIds) {
    for (const resourceId of requestedResourceIds) {
      const path = `./data/resources/${regionId}/${resourceId}.json`;
      try {
        const res = await fetch(path);
        if (!res.ok) {
          missing.push(`${regionId}/${resourceId}`);
          continue;
        }
        const geojson = await res.json();
        const coords = geojson?.features?.[0]?.geometry?.coordinates || [];
        for (const [x, z] of coords) {
          L.circleMarker([z, x], {
            renderer: resourceRenderer,
            radius: 2.6,
            weight: 0,
            fillOpacity: 0.65,
            fillColor: '#ffcc66',
          }).addTo(resourceLayer);
        }
        loaded.push({ regionId, resourceId, count: coords.length });
      } catch (error) {
        missing.push(`${regionId}/${resourceId}`);
      }
    }
  }

  if (loaded.length) {
    const summary = loaded.map((x) => `resource ${x.resourceId} in region ${x.regionId}: ${x.count} points`).join(' · ');
    dom.resourceStatus.textContent = `Loaded cached snapshot: ${summary}`;
    dom.resourceStatus.className = 'notice';
  } else {
    dom.resourceStatus.textContent = 'Requested resource snapshot not cached here yet. Open the official link or add a new cache file in the repo.';
    dom.resourceStatus.className = 'notice warn';
  }

  if (missing.length) {
    console.warn('Missing cached resources:', missing);
  }
}

function connectAelFeed() {
  dom.status.textContent = 'Connecting to live.bitjita.com…';

  const ws = new WebSocket(LIVE_WS);
  ws.addEventListener('open', () => {
    dom.status.textContent = 'Subscribed';
    ws.send(JSON.stringify({ type: 'subscribe', channels: [`mobile_entity_state:${DEFAULT_PLAYER.entityId}`] }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'subscribed') {
      return;
    }
    if (msg.type !== 'event' || !msg.data) {
      return;
    }

    const data = msg.data;
    const x = typeof data.location_x === 'number' ? data.location_x / 1000 : null;
    const z = typeof data.location_z === 'number' ? data.location_z / 1000 : null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return;
    }

    const region = data.region_id ? Number(data.region_id) : regionIdFromCoord(x, z);
    const latLng = [z, x];
    aelMarker.setLatLng(latLng);
    if (!markerLayer.hasLayer(aelMarker)) {
      markerLayer.addLayer(aelMarker);
    }
    aelMarker.bindPopup(`Ael<br>X ${x.toFixed(3)}<br>Z ${z.toFixed(3)}<br>Region ${region ?? 'unknown'}`);

    dom.coordX.textContent = x.toFixed(3);
    dom.coordZ.textContent = z.toFixed(3);
    dom.coordRegion.textContent = String(region ?? 'unknown');
    dom.coordTimestamp.textContent = data.timestamp ? String(data.timestamp) : 'live';
    dom.status.textContent = data.is_walking ? 'Live · walking' : 'Live';
    aelKnown = true;

    if (dom.followToggle.checked) {
      map.setView(latLng, Math.max(map.getZoom(), 0.6), { animate: false });
    }
  });

  ws.addEventListener('close', () => {
    if (dom.status.textContent.startsWith('Live')) {
      dom.status.textContent = 'Feed closed';
    } else {
      dom.status.textContent = 'Feed closed before first live update';
    }
  });

  ws.addEventListener('error', () => {
    if (!aelKnown) {
      dom.status.textContent = 'Live feed error';
    }
  });
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

function makeOfficialLink(regionIds, resourceIds) {
  const url = new URL('https://bitcraftmap.com/');
  if (regionIds.length) url.searchParams.set('regionId', regionIds.join(','));
  if (resourceIds.length) url.searchParams.set('resourceId', resourceIds.join(','));
  return url.toString();
}
