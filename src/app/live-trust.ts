import { isFiniteNumber, type WorldPoint } from '../shared/bitcraft';
import type { LiveStateSnapshot } from '../shared/live-state';
import type { PlayerRecord } from './types';

export interface PendingLiveCandidate {
  entityId: string;
  x: number;
  z: number;
  timestamp: number | null;
}

interface TrustDecision {
  accept: boolean;
  nextPending: PendingLiveCandidate | null;
}

export function decideLiveUpdateTrust(
  entityId: string,
  current: PlayerRecord | null,
  liveState: LiveStateSnapshot,
  pending: PendingLiveCandidate | null,
): TrustDecision {
  if (!isFiniteNumber(liveState.x) || !isFiniteNumber(liveState.z)) {
    return { accept: false, nextPending: pending };
  }

  const point = { x: liveState.x, z: liveState.z };
  const previousPoint =
    current && isFiniteNumber(current.x) && isFiniteNumber(current.z)
      ? { x: current.x, z: current.z }
      : null;

  if (!current || !previousPoint) {
    return { accept: true, nextPending: null };
  }

  if (current.source !== 'live') {
    const distanceFromPrevious = worldDistance(previousPoint, point);
    if (distanceFromPrevious <= 1800) {
      return { accept: true, nextPending: null };
    }
  }

  const dtSeconds = deriveDeltaSeconds(current.timestamp, liveState.timestamp);
  const plausibleJump = 140 + dtSeconds * 64;
  const distanceFromPrevious = worldDistance(previousPoint, point);
  const previousDestination =
    isFiniteNumber(current.destinationX) && isFiniteNumber(current.destinationZ)
      ? { x: current.destinationX, z: current.destinationZ }
      : null;
  const nearPreviousDestination = previousDestination
    ? worldDistance(previousDestination, point) <= Math.max(220, plausibleJump * 1.5)
    : false;

  if (distanceFromPrevious <= plausibleJump || nearPreviousDestination) {
    return { accept: true, nextPending: null };
  }

  if (pending) {
    const pendingPoint = { x: pending.x, z: pending.z };
    if (worldDistance(pendingPoint, point) <= 140) {
      return { accept: true, nextPending: null };
    }
  }

  return {
    accept: false,
    nextPending: {
      entityId,
      x: liveState.x,
      z: liveState.z,
      timestamp: liveState.timestamp,
    },
  };
}

function deriveDeltaSeconds(previousTimestamp: number | null, nextTimestamp: number | null): number {
  if (!isFiniteNumber(previousTimestamp) || !isFiniteNumber(nextTimestamp)) {
    return 1;
  }

  const delta = nextTimestamp - previousTimestamp;
  if (!Number.isFinite(delta) || delta <= 0) {
    return 1;
  }

  return Math.min(15, delta);
}

function worldDistance(left: WorldPoint, right: WorldPoint): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}
