import { describe, expect, it } from 'vitest';

import { decideLiveUpdateTrust } from '../src/app/live-trust';
import type { LiveStateSnapshot } from '../src/shared/live-state';
import type { PlayerRecord } from '../src/app/types';

describe('live update trust', () => {
  it('holds implausible large jumps until they repeat consistently', () => {
    const current = makePlayer({
      x: 11410,
      z: 16089,
      timestamp: 100,
      source: 'live',
      destinationX: 11412,
      destinationZ: 16090,
    });

    const suspicious = makeLiveState({ x: 13500, z: 18000, timestamp: 101 });
    const first = decideLiveUpdateTrust('ael', current, suspicious, null);
    expect(first.accept).toBe(false);
    expect(first.nextPending).toBeTruthy();

    const confirm = decideLiveUpdateTrust('ael', current, makeLiveState({ x: 13520, z: 18010, timestamp: 102 }), first.nextPending);
    expect(confirm.accept).toBe(true);
    expect(confirm.nextPending).toBeNull();
  });

  it('accepts plausible nearby motion immediately', () => {
    const current = makePlayer({
      x: 11410,
      z: 16089,
      timestamp: 100,
      source: 'live',
      destinationX: 11413,
      destinationZ: 16092,
    });

    const next = decideLiveUpdateTrust('ael', current, makeLiveState({ x: 11412.5, z: 16091.4, timestamp: 101 }), null);
    expect(next.accept).toBe(true);
    expect(next.nextPending).toBeNull();
  });
});

function makePlayer(overrides: Partial<PlayerRecord>): PlayerRecord {
  return {
    entityId: 'ael',
    username: 'Ael',
    x: 11410,
    z: 16089,
    regionId: 12,
    timestamp: 100,
    source: 'live',
    signedIn: true,
    lastLoginTimestamp: null,
    destinationX: 11411,
    destinationZ: 16090,
    ...overrides,
  };
}

function makeLiveState(overrides: Partial<LiveStateSnapshot>): LiveStateSnapshot {
  return {
    entityId: 'ael',
    regionId: 12,
    x: 11410,
    z: 16089,
    destinationX: null,
    destinationZ: null,
    timestamp: 100,
    isWalking: true,
    ...overrides,
  };
}
