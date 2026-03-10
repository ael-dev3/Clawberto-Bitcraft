import {
  PLAYER_DETAIL_LOCATION_SOURCE,
  PLAYER_DETAIL_TELEPORT_SOURCE,
  buildPlayerDetailUrl,
  regionIdFromCoord,
} from '../bitcraft';
import {
  playerDetailResponseSchema,
  type PlayerDetailResponse,
} from '../schemas';
import { fetchJsonWithSchema } from './fetch-json';

export interface NormalizedPlayerDetailState {
  x: number;
  z: number;
  regionId: number | null;
  source: typeof PLAYER_DETAIL_LOCATION_SOURCE | typeof PLAYER_DETAIL_TELEPORT_SOURCE;
  signedIn: boolean | null;
  lastLoginTimestamp: string | null;
}

export async function fetchPlayerDetail(entityId: string, label = `player detail ${entityId}`): Promise<PlayerDetailResponse | null> {
  return fetchJsonWithSchema(buildPlayerDetailUrl(entityId), playerDetailResponseSchema, label);
}

export function normalizePlayerDetailState(
  detail: PlayerDetailResponse | null,
  defaultRegionId?: number | null,
): NormalizedPlayerDetailState | null {
  const player = detail?.player;
  if (!player) {
    return null;
  }

  if (typeof player.locationX === 'number' && typeof player.locationZ === 'number') {
    return {
      x: player.locationX,
      z: player.locationZ,
      regionId: player.regionId ?? regionIdFromCoord(player.locationX, player.locationZ) ?? defaultRegionId ?? null,
      source: PLAYER_DETAIL_LOCATION_SOURCE,
      signedIn: player.signedIn ?? null,
      lastLoginTimestamp: player.lastLoginTimestamp ?? null,
    };
  }

  if (typeof player.teleportLocationX === 'number' && typeof player.teleportLocationZ === 'number') {
    return {
      x: player.teleportLocationX,
      z: player.teleportLocationZ,
      regionId:
        player.regionId ??
        regionIdFromCoord(player.teleportLocationX, player.teleportLocationZ) ??
        defaultRegionId ??
        null,
      source: PLAYER_DETAIL_TELEPORT_SOURCE,
      signedIn: player.signedIn ?? null,
      lastLoginTimestamp: player.lastLoginTimestamp ?? null,
    };
  }

  return null;
}
