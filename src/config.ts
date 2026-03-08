export const MAP_SIZE = 38_400;
export const REGION_GRID = 5;
export const REGION_SIZE = MAP_SIZE / REGION_GRID;
export const APOTHEM = 2 / Math.sqrt(3);

export const LIVE_WS = 'wss://live.bitjita.com';
export const TERRAIN_PATH = './assets/terrain/region12.png';
export const RUNTIME_AEL_CACHE_PATH = './runtime/ael-live.json';
export const TRACKED_PLAYERS_CACHE_PATH = './runtime/tracked-players.json';
export const TRACKED_PLAYERS_CONFIG_PATH = './data/tracked-players.json';

export const RUNTIME_CACHE_REFRESH_MS = 30_000;
export const LIVE_FRESHNESS_SECONDS = 90;
export const FIXED_REGION_ID = 12;

export const DEFAULT_PLAYER = {
  username: 'Ael',
  entityId: '648518346354069088',
  defaultRegionId: FIXED_REGION_ID,
} as const;
