# Clawberto-Bitcraft

Production-oriented Bitcraft overlay research and mapping app, modernized to a small Vite + TypeScript toolchain without changing the core Leaflet map model.

## What this repo ships

1. A Vite-built static site for GitHub Pages
2. A region-12-only Leaflet overlay for Ael plus tracked players
3. Runtime JSON caches for hosted Ael and tracked-player refreshes
4. Cached resource snapshots for region-scoped overlays
5. Shared Zod schemas used by both the browser app and cache refresh scripts
6. Smoke tests and unit tests for the current hosted behavior

## Current app behavior

The app still preserves the original user-facing behavior:

- fixed region 12 terrain only
- live Ael websocket tracking with runtime-cache fallback
- tracked players with websocket movement updates plus player-detail fallback
- runtime JSON refresh polling in the browser
- manual pin placement inside region 12 only
- map popups and collision-aware player labels
- cached resource overlays driven by `resourceId`
- hosted GitHub Pages deployment from built output

## Modernized structure

```text
src/
  app/                  app controller, map controller, typed browser modules
  shared/               region math, schemas, websocket normalization, helpers
  ui/                   DOM bindings and styling
public/
  assets/terrain/       static terrain image copied into the build
  data/                 tracked-player config and cached resource snapshots
  runtime/              hosted runtime cache JSON files
scripts/
  *.ts                  typed cache refresh, smoke, and utility scripts
tests/
  *.test.ts             helper/schema regression coverage
```

## Local development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the built site locally:

```bash
npm run preview
```

Run typecheck, tests, and build together:

```bash
npm run check
```

Run the local production smoke test:

```bash
npm run smoke:local
```

## Runtime cache refresh scripts

Refresh the hosted Ael cache:

```bash
npm run update:ael-cache
```

Refresh the tracked-player cache:

```bash
npm run update:tracked-cache
```

Inspect Ael's live websocket payloads:

```bash
npm run query:ael-live
```

Add another cached resource snapshot:

```bash
npm run fetch:resource -- 12 1180909566
```

That writes to:

```text
public/data/resources/12/1180909566.json
```

## Query params

- `resourceId=1180909566`
- `center=9342.399,16389.730`
- `zoom=1.2`

Notes:

- the build is fixed to `regionId=12`
- centers outside region 12 are ignored

## GitHub Pages deployment

The production site is built with `base: './'`, so generated asset URLs stay relative and continue working on GitHub Pages subpaths.

The Pages workflow now:

1. installs dependencies
2. refreshes the runtime cache JSON files
3. builds the site into `dist/`
4. uploads `dist/` to GitHub Pages

## Research summary

The repo still uses the same verified Bitcraft data path:

- player detail from `https://bitcraftmap.com/api/players/:entityId`
- live movement from `wss://live.bitjita.com`
- region resource data from `https://bcmap-api.bitjita.com/region{regionId}/resource/{resourceId}`

Coordinates from the live websocket remain scaled by `1000`, so the overlay still converts:

```text
display_x = location_x / 1000
display_z = location_z / 1000
```

Region math is unchanged:

```text
region_size = 38400 / 5 = 7680
regionId = floor(z / 7680) * 5 + floor(x / 7680) + 1
```

Region 12 bounds remain:

```text
x: 7680 .. 15360
z: 15360 .. 23040
```
