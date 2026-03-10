import {
  BITCRAFT_LIVE_SOURCE,
  PLAYER_DETAIL_LOCATION_SOURCE,
  PLAYER_DETAIL_TELEPORT_SOURCE,
} from './bitcraft';
import { LIVE_FRESHNESS_SECONDS } from '../config';

export interface FreshnessCandidate {
  source?: string | null;
  timestamp?: number | null;
}

export function normalizeDisplaySource(source: string | null | undefined): string {
  const baseSource = (String(source ?? '').split(';')[0] ?? '').trim();

  switch (baseSource) {
    case PLAYER_DETAIL_LOCATION_SOURCE:
      return 'detail';
    case PLAYER_DETAIL_TELEPORT_SOURCE:
      return 'detail-home';
    case BITCRAFT_LIVE_SOURCE:
    case 'live':
      return 'live';
    case '':
      return 'unknown';
    default:
      return baseSource;
  }
}

export function isFreshLiveTimestamp(timestamp: number | null | undefined): boolean {
  if (!Number.isFinite(timestamp) || Number(timestamp) <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - Number(timestamp)) <= LIVE_FRESHNESS_SECONDS;
}

export function shouldKeepFreshLiveState(candidate: FreshnessCandidate | null | undefined): boolean {
  if (!candidate) return false;
  return normalizeDisplaySource(candidate.source) === 'live' && isFreshLiveTimestamp(candidate.timestamp);
}
