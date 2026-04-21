import { z } from 'zod';

import { FIXED_REGION_ID, MAP_SIZE, REGION_GRID, REGION_SIZE } from '../config';

export interface WorldPoint {
  x: number;
  z: number;
}

export interface RegionBounds {
  row: number;
  col: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface ParsedBitcraftQuery {
  requestedResourceIds: number[];
  requestedCenter: WorldPoint | null;
  requestedZoom: number | null;
}

export const BITCRAFT_WEB_ORIGIN = 'https://bitcraftmap.com';
export const BITCRAFT_RESOURCE_API_ORIGIN = 'https://bcmap-api.bitjita.com';
export const BITCRAFT_LIVE_WS_URL = 'wss://live.bitjita.com';
export const BITCRAFT_LIVE_SOURCE = 'live.bitjita.com';
export const MOBILE_ENTITY_STATE_CHANNEL = 'mobile_entity_state';
export const PLAYER_DETAIL_LOCATION_SOURCE = 'player-detail-location';
export const PLAYER_DETAIL_TELEPORT_SOURCE = 'player-detail-teleport';
export const MAP_MIN_ZOOM = -2;
export const MAP_MAX_ZOOM = 5;

const positiveResourceIdSchema = z.number().int().positive();
const queryZoomSchema = z.number().finite().min(MAP_MIN_ZOOM).max(MAP_MAX_ZOOM);

export function parseIdList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .flatMap((value) => {
      const parsed = positiveResourceIdSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
}

export function buildMobileEntityStateChannel(entityId: string): string {
  return `${MOBILE_ENTITY_STATE_CHANNEL}:${entityId}`;
}

export function buildPlayerDetailUrl(entityId: string): string {
  return new URL(`/api/players/${encodeURIComponent(entityId)}`, BITCRAFT_WEB_ORIGIN).toString();
}

export function buildResourceSnapshotUrl(regionId: number | string, resourceId: number | string): string {
  return new URL(`/region${regionId}/resource/${resourceId}`, BITCRAFT_RESOURCE_API_ORIGIN).toString();
}

export function parseCenter(raw: string | null): WorldPoint | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]?.trim());
  const z = Number(parts[1]?.trim());
  return parseCenterPoint({ x, z });
}

export function parseRequestedZoom(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  const parsed = queryZoomSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function regionIdFromCoord(x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (x < 0 || z < 0 || x >= MAP_SIZE || z >= MAP_SIZE) return null;
  const col = Math.floor(x / REGION_SIZE);
  const row = Math.floor(z / REGION_SIZE);
  return row * REGION_GRID + col + 1;
}

export function getRegionBounds(regionId: number): RegionBounds {
  const boundedIndex = Math.max(1, Math.min(REGION_GRID * REGION_GRID, Number(regionId))) - 1;
  const row = Math.floor(boundedIndex / REGION_GRID);
  const col = boundedIndex % REGION_GRID;
  const xMin = col * REGION_SIZE;
  const xMax = xMin + REGION_SIZE;
  const zMin = row * REGION_SIZE;
  const zMax = zMin + REGION_SIZE;
  return { row, col, xMin, xMax, zMin, zMax };
}

export const fixedRegionBounds = getRegionBounds(FIXED_REGION_ID);

export function isInsideRegion(point: WorldPoint, region: RegionBounds): boolean {
  return point.x >= region.xMin && point.x < region.xMax && point.z >= region.zMin && point.z < region.zMax;
}

export function isInsideFixedRegion(point: WorldPoint): boolean {
  return isInsideRegion(point, fixedRegionBounds);
}

export function makeOfficialLink(resourceIds: number[]): string {
  const url = new URL('/', BITCRAFT_WEB_ORIGIN);
  url.searchParams.set('regionId', String(FIXED_REGION_ID));
  if (resourceIds.length > 0) {
    url.searchParams.set('resourceId', resourceIds.join(','));
  }
  return url.toString();
}

export function parseBitcraftQuery(search: string | URLSearchParams): ParsedBitcraftQuery {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;

  return {
    requestedResourceIds: parseIdList(params.get('resourceId')),
    requestedCenter: parseCenter(params.get('center')),
    requestedZoom: parseRequestedZoom(params.get('zoom')),
  };
}

export function extractEntityId(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const parts = String(channel).split(':');
  return parts.at(-1) ?? null;
}

export function coerceOptionalNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function resolvePublicUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).toString();
}

function parseCenterPoint(point: WorldPoint): WorldPoint | null {
  const centerSchema = z.object({
    x: z.number().finite().min(fixedRegionBounds.xMin).lt(fixedRegionBounds.xMax),
    z: z.number().finite().min(fixedRegionBounds.zMin).lt(fixedRegionBounds.zMax),
  });

  const parsed = centerSchema.safeParse(point);
  return parsed.success ? parsed.data : null;
}
