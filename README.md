# Clawberto Bitcraft

Production-ready Bitcraft region overlay focused on Region 12, built with Vite, TypeScript, and Leaflet.

## Live Website

https://ael-dev3.github.io/Clawberto-Bitcraft/

## Overview

Clawberto Bitcraft is a lightweight, GitHub Pages-hosted map overlay for monitoring Ael's live position in Bitcraft Region 12. The app keeps the original overlay workflow intact while moving the project onto a smaller, typed, maintainable frontend stack.

The hosted build is intentionally constrained to Region 12 and avoids full-world map loading. It combines live websocket updates, cached runtime data, tracked-player overlays, and optional resource snapshots in a static deployment model that is reliable enough for public hosting.

## Highlights

- Region-12-only terrain overlay with a fixed map scope
- Live Ael position updates from websocket data with runtime-cache fallback
- Tracked player rendering with movement updates and player-detail fallback
- Manual pin placement for Region 12 coordinates
- Optional cached resource overlays driven by `resourceId`
- Query-parameter support for shareable map state
- Static GitHub Pages deployment with automated build and publish workflow

## Tech Stack

- Vite
- TypeScript
- Leaflet
- Zod
- Vitest
- Playwright-based smoke coverage

## Project Structure

```text
src/
  app/                  app controller, map controller, state, services
  shared/               schemas, region math, websocket normalization, helpers
  ui/                   DOM bindings and styles
public/
  assets/terrain/       static terrain assets
  data/                 tracked-player config and cached resource snapshots
  runtime/              hosted runtime cache JSON files
scripts/
  *.ts                  cache refresh, smoke, and utility scripts
tests/
  *.test.ts             unit and regression coverage
```

## Getting Started

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Preview the production build

```bash
npm run preview
```

### Run the standard verification pass

```bash
npm run check
```

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite development server |
| `npm run build` | Create the production build |
| `npm run preview` | Preview the built site locally |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run the Vitest suite |
| `npm run check` | Run typecheck, tests, and production build |
| `npm run update:ael-cache` | Refresh the hosted Ael runtime cache |
| `npm run update:tracked-cache` | Refresh the hosted tracked-player runtime cache |
| `npm run query:ael-live` | Inspect Ael live websocket payloads |
| `npm run fetch:resource -- <regionId> <resourceId>` | Fetch and store a resource snapshot |
| `npm run smoke:local` | Run the local smoke test against a local build |
| `npm run smoke:hosted` | Run the smoke test against the live GitHub Pages site |

## Query Parameters

The hosted app accepts a small set of URL parameters for reproducible views:

- `resourceId=1180909566`
- `center=9342.399,16389.730`
- `zoom=1.2`

Notes:

- The production build is fixed to `regionId=12`
- Coordinates outside Region 12 are ignored

## Resource Snapshot Workflow

To cache an additional resource snapshot locally:

```bash
npm run fetch:resource -- 12 1180909566
```

This writes the snapshot to:

```text
public/data/resources/12/1180909566.json
```

## Deployment

The site is deployed to GitHub Pages from `main` through the workflow in `.github/workflows/pages.yml`.

Deployment pipeline:

1. Install dependencies
2. Refresh runtime cache JSON files
3. Build the production site into `dist/`
4. Upload the artifact to GitHub Pages
5. Publish the latest build

The Vite config uses `base: './'` so asset URLs stay relative and continue working under the repository Pages subpath.

## Data Sources

The current overlay behavior is built around the same Bitcraft data path used during the research phase:

- Live movement feed: `wss://live.bitjita.com`
- Player detail API: `https://bitcraftmap.com/api/players/:entityId`
- Region resource API: `https://bcmap-api.bitjita.com/region{regionId}/resource/{resourceId}`

Resource API responses are CORS-restricted to `bitcraftmap.com`, so this project stores example resource snapshots locally for hosted usage.

## Coordinate Notes

Live websocket coordinates are scaled by `1000`, so the overlay converts:

```text
display_x = location_x / 1000
display_z = location_z / 1000
```

Region 12 bounds:

```text
x: 7680 .. 15360
z: 15360 .. 23040
```
