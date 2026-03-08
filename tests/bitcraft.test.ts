import { describe, expect, it } from 'vitest';

import { FIXED_REGION_ID, REGION_SIZE } from '../src/config';
import {
  getRegionBounds,
  makeOfficialLink,
  parseCenter,
  parseIdList,
  parseRequestedZoom,
  regionIdFromCoord,
} from '../src/shared/bitcraft';
import { normalizeDisplaySource, shouldKeepFreshLiveState } from '../src/shared/player-source';

describe('bitcraft helpers', () => {
  it('computes region 12 bounds from the fixed grid', () => {
    expect(REGION_SIZE).toBe(7680);
    expect(getRegionBounds(FIXED_REGION_ID)).toEqual({
      row: 2,
      col: 1,
      xMin: 7680,
      xMax: 15360,
      zMin: 15360,
      zMax: 23040,
    });
  });

  it('maps world coordinates into the expected region id', () => {
    expect(regionIdFromCoord(9342.399, 16389.73)).toBe(12);
    expect(regionIdFromCoord(-1, 100)).toBeNull();
  });

  it('parses query input safely', () => {
    expect(parseIdList('1180909566, nope, 12')).toEqual([1180909566, 12]);
    expect(parseCenter('9342.399,16389.73')).toEqual({ x: 9342.399, z: 16389.73 });
    expect(parseCenter('bad')).toBeNull();
    expect(parseRequestedZoom('1.2')).toBe(1.2);
    expect(parseRequestedZoom('wat')).toBeNull();
  });

  it('normalizes source labels and live freshness', () => {
    expect(normalizeDisplaySource('player-detail-location')).toBe('detail');
    expect(normalizeDisplaySource('live.bitjita.com')).toBe('live');
    expect(
      shouldKeepFreshLiveState({
        source: 'live',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ).toBe(true);
  });

  it('builds the official region-12 link', () => {
    expect(makeOfficialLink([1180909566])).toBe('https://bitcraftmap.com/?regionId=12&resourceId=1180909566');
  });
});
