# Clawberto-Bitcraft

Deep research + working overlay software for Bitcraftmap.

## What this repo ships

1. **Research findings** on the Bitcraftmap frontend/backend/API stack
2. **A hosted static overlay app** that shows **Ael's live coordinates** on a Bitcraft-style map
3. **Region math** for Bitcraftmap regions
4. **Cached resource snapshots** for query-driven overlays like:
   - `?resourceId=1180909566&regionId=12`
5. **GitHub Pages deployment** so the app can be hosted online from this repo

## Hosted app

After GitHub Pages deploys, use:

- `https://ael-dev3.github.io/Clawberto-Bitcraft/`
- example: `https://ael-dev3.github.io/Clawberto-Bitcraft/?resourceId=1180909566&regionId=12`

## Main result

I found a better path than using Balduran as the live feed.

### Native Bitcraft live tracking path

Bitcraftmap itself exposes:
- player search API on `bitcraftmap.com/api/players`
- player detail API on `bitcraftmap.com/api/players/:entityId`
- live websocket on `wss://live.bitjita.com`

For **Ael**:
- entity ID: `648518346354069088`
- official Bitcraftmap detail API works:
  - `GET https://bitcraftmap.com/api/players/648518346354069088`
- live mobile entity websocket subscription works:
  - channel: `mobile_entity_state:648518346354069088`

That live websocket returns updates like:
- `location_x`
- `location_z`
- `region_id`
- `destination_x`
- `destination_z`

Those coordinates are scaled by `1000`, so:

```text
display_x = location_x / 1000
display_z = location_z / 1000
```

Example live event observed during research:

```json
{
  "type": "event",
  "channel": "mobile_entity_state:648518346354069088",
  "data": {
    "location_x": 9342399,
    "location_z": 16389730,
    "region_id": "12"
  }
}
```

Which means:
- `X = 9342.399`
- `Z = 16389.730`
- `Region = 12`

## What frontend Bitcraftmap uses

Studied directly from the live production bundle.

### Frontend stack

- **SvelteKit** frontend
- **Leaflet** map engine
- **Leaflet.markercluster** for point clustering
- **Cloudflare** in front
- Bitcraft map tiles from `https://exports.bitjita.com`
- live websocket from `wss://live.bitjita.com`

### Key frontend facts extracted from the bundle

- route is query-param driven via:
  - `resourceId`
  - `regionId`
  - `enemyId`
  - `playerId`
  - `followPlayer`
  - `center`
  - `zoom`
- active selectable regions in the live UI are:
  - `7, 8, 9, 12, 13, 14, 17, 18, 19`
- map size is:
  - width `38400`
  - height `38400`
- exported tile path used by Bitcraftmap:
  - `${exportsCdn}/bitcraftmap/maps/tiles/{z}/{x}/{y}.webp`

## What backend/services it connects to

### 1. bitcraftmap.com
Used for player/resource search APIs:

- `GET /api/players?q=<query>`
- `GET /api/players/:entityId`
- `GET /api/resources?q=<query>`

### 2. bcmap-api.bitjita.com
Used for region-scoped GeoJSON payloads:

- `GET /region{regionId}/resource/{resourceId}`
- `GET /region{regionId}/enemy/{enemyId}`

Example confirmed working:

- `https://bcmap-api.bitjita.com/region12/resource/1180909566`

### 3. live.bitjita.com
Used for live websocket subscriptions:

- `mobile_entity_state:{entityId}`
- `resource_state:resource_id:{resourceId}`

### 4. exports.bitjita.com
Used for exported map tiles and overlays.

## Region math

The map is a `38400 x 38400` world and the region grid is effectively `5 x 5`.

So:

```text
region_size = 38400 / 5 = 7680
```

### Region ID from coordinates

Using world coordinates `(x, z)`:

```text
col = floor(x / 7680)
row = floor(z / 7680)
regionId = row * 5 + col + 1
```

### Region 12 bounds

```text
x:  7680  .. 15360
z: 15360  .. 23040
```

This matches live Ael samples observed from both:
- Balduran map relay
- native Bitcraft websocket

## Why the app uses cached resource snapshots

The resource GeoJSON API responds with CORS locked to:
- `https://bitcraftmap.com`

That means a GitHub Pages app cannot freely fetch arbitrary live resource GeoJSON from the browser.

So this repo does two things:
- overlays **live Ael coordinates** natively from the websocket
- loads **cached resource snapshots** from repo data files for supported examples

Currently included:
- `data/resources/12/1180909566.json`
  - resource `1180909566`
  - region `12`
  - 3756 points

## App behavior

The hosted app:
- renders the real Bitcraft terrain map from `https://bitcraftmap.com/assets/maps/map.webp`
- connects to `wss://live.bitjita.com`
- subscribes to Ael's mobile entity channel
- converts `location_x` / `location_z` into map coordinates
- draws a live Ael marker
- highlights requested `regionId`
- loads cached resource snapshot points when available
- supports manual pin drop for any custom `X/Z`

## Query params supported by this app

- `regionId=12`
- `resourceId=1180909566`
- `center=9342.399,16389.730`
- `zoom=1.2`

Example:

```text
/?resourceId=1180909566&regionId=12
```

## Repo structure

- `index.html` — hosted app shell
- `app.js` — map, websocket, overlay logic
- `style.css` — UI styling
- `data/resources/12/1180909566.json` — cached resource snapshot
- `research/findings.md` — detailed research notes
- `scripts/query-ael-live.mjs` — CLI to inspect live Ael websocket data
- `scripts/fetch-resource-snapshot.mjs` — CLI to cache a region/resource GeoJSON file
- `.github/workflows/pages.yml` — GitHub Pages deploy workflow

## Local development

Serve statically:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Add another cached resource snapshot

```bash
node scripts/fetch-resource-snapshot.mjs 12 1180909566
```

That writes to:

```text
data/resources/12/1180909566.json
```

## Drift diagnosis and fixes

Where I drifted before:
- I validated **assets and headers**, but not the **rendered hosted page state**.
- I assumed the terrain problem was only a bad layer URL, but the bigger hosted failure was:
  - opening too zoomed out
  - no immediate fallback marker unless a live websocket event arrived
- I had no enforceable rule saying **"do not claim hosted success until a browser simulation sees terrain + marker + coordinates"**.

What I built to stop that drift:
- default view now opens on **region 12**, not the full-world tiny overview
- hosted app now loads a **runtime Ael cache** so it shows a marker even before the next live websocket event
- runtime diagnostics panel now shows:
  - terrain status
  - cache status
  - marker readiness
  - current zoom
- scheduled GitHub Pages deploy refreshes the runtime Ael cache every **15 minutes**
- smoke-test workflow runs browser simulations on push and hourly against:
  - local build
  - hosted Pages site
- smoke test asserts:
  - terrain image loaded
  - marker rendered
  - coordinates present
  - region label present
  - no bad boot/feed status

## Findings quality bar

This repo is based on:
- direct bundle inspection of production Bitcraftmap code
- live API queries against public Bitcraftmap endpoints
- live websocket subscription tests against the native Bitcraft live feed
- direct resource GeoJSON retrieval for the example resource in region 12
- cross-checking region math against observed coordinates
- browser render simulations against both local and hosted versions
