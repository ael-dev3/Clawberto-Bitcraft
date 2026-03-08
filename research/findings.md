# Bitcraftmap research findings

## Summary

Bitcraftmap is a SvelteKit + Leaflet application behind Cloudflare. It pulls static tiles from `exports.bitjita.com`, search/detail JSON from `bitcraftmap.com`, region GeoJSON from `bcmap-api.bitjita.com`, and live entity/resource state from `wss://live.bitjita.com`.

## Frontend evidence

Observed from the production JS bundle (`_app/immutable/nodes/2.*.js`):

- env defaults:
  - `backendUrl = https://bcmap-api.bitjita.com`
  - `websocketUrl = wss://live.bitjita.com`
  - `exportsCdn = https://exports.bitjita.com`
- map dimensions:
  - `mapWidth = 38400`
  - `mapHeight = 38400`
- query parsing:
  - `resourceId`
  - `regionId`
  - `enemyId`
  - `playerId`
  - `followPlayer`
  - `center`
  - `zoom`
- active region set in UI:
  - `[7,8,9,12,13,14,17,18,19]`
- player search API:
  - `fetch('/api/players?q=...')`
- player detail API:
  - `fetch('/api/players/${id}')`
- resource search API:
  - `fetch('/api/resources?q=...')`
- region resource fetch:
  - `fetch('${backendUrl}/region${regionId}/resource/${resourceId}')`
- region enemy fetch:
  - `fetch('${backendUrl}/region${regionId}/enemy/${enemyId}')`
- player live websocket:
  - subscribe channel `mobile_entity_state:${entityId}`
- resource live websocket:
  - subscribe channel `resource_state:resource_id:${resourceId}`

## Confirmed live HTTP endpoints

### Player search

```http
GET https://bitcraftmap.com/api/players?q=Ael
```

Confirmed result includes:
- `entityId = 648518346354069088`
- `username = Ael`

### Player detail

```http
GET https://bitcraftmap.com/api/players/648518346354069088
```

Confirmed result includes fields such as:
- `teleportLocationX`
- `teleportLocationZ`
- `experience`
- account metadata

### Resource search

```http
GET https://bitcraftmap.com/api/resources?q=Crystalized%20Sand
```

Confirmed result includes:
- resource `1180909566`
- name `Crystalized Sand`

### Region resource GeoJSON

```http
GET https://bcmap-api.bitjita.com/region12/resource/1180909566
Origin: https://bitcraftmap.com
Referer: https://bitcraftmap.com/
```

Confirmed:
- returns GeoJSON FeatureCollection
- response carries:
  - `Access-Control-Allow-Origin: https://bitcraftmap.com`
- practical result:
  - browser fetches from GitHub Pages are blocked by CORS

## Confirmed live websocket path

### Websocket origin

```text
wss://live.bitjita.com
```

### Subscription tested

```json
{
  "type": "subscribe",
  "channels": ["mobile_entity_state:648518346354069088"]
}
```

Confirmed responses included events like:

```json
{
  "type": "event",
  "channel": "mobile_entity_state:648518346354069088",
  "data": {
    "location_x": 9342399,
    "location_z": 16389730,
    "destination_x": 9342519,
    "destination_z": 16389785,
    "region_id": "12",
    "dimension": 1,
    "event_type": "update"
  }
}
```

### Coordinate scaling

The live entity state is scaled by `1000`:

```text
world_x = location_x / 1000
world_z = location_z / 1000
```

So the example above becomes:
- `X = 9342.399`
- `Z = 16389.730`
- `Region = 12`

## Region math derivation

The app bundle exposes:
- total map width/height `38400`
- selectable regions correspond to a 5x5 numbering model

Therefore:

```text
region_size = 38400 / 5 = 7680
```

Region formula:

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

This matches observed Ael live coordinates.

## Why the repo app is built the way it is

### What works live from a hosted static app

- exported map tiles from `exports.bitjita.com`
- websocket to `wss://live.bitjita.com`
- local static JSON files inside the repo

### What does not work generically from GitHub Pages

- arbitrary live `bcmap-api.bitjita.com` resource GeoJSON fetches

Reason:
- CORS allowlist is pinned to `https://bitcraftmap.com`

So the best fully-hostable design is:
- use native websocket for live Ael coordinates
- use repo-cached GeoJSON for specific resource overlays
- keep official Bitcraftmap deep links for anything broader
