import { LIVE_FRESHNESS_SECONDS } from '../config';

export interface FreshnessCandidate {
  source?: string | null;
  timestamp?: number | null;
}

export function normalizeDisplaySource(source: string | null | undefined): string {
  const baseSource = (String(source ?? '').split(';')[0] ?? '').trim();

  switch (baseSource) {
    case 'player-detail-location':
      return 'detail';
    case 'player-detail-teleport':
      return 'detail-home';
    case 'live.bitjita.com':
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
