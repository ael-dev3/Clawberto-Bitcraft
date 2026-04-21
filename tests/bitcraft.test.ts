import { describe, expect, it } from 'vitest';

import { FIXED_REGION_ID, REGION_SIZE } from '../src/config';
import {
  BITCRAFT_LIVE_SOURCE,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  PLAYER_DETAIL_LOCATION_SOURCE,
  buildMobileEntityStateChannel,
  buildPlayerDetailUrl,
  buildResourceSnapshotUrl,
  getRegionBounds,
  isInsideFixedRegion,
  makeOfficialLink,
  parseBitcraftQuery,
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

  it('treats region upper bounds as exclusive to avoid cross-region ambiguity', () => {
    expect(isInsideFixedRegion({ x: 7680, z: 15360 })).toBe(true);
    expect(isInsideFixedRegion({ x: 15359.999, z: 23039.999 })).toBe(true);
    expect(isInsideFixedRegion({ x: 15360, z: 16389.73 })).toBe(false);
    expect(isInsideFixedRegion({ x: 9342.399, z: 23040 })).toBe(false);
    expect(parseCenter('15360,16389.73')).toBeNull();
    expect(parseCenter('9342.399,23040')).toBeNull();
  });

  it('parses query input safely', () => {
    expect(parseIdList('1180909566, nope, 12, 0, -7, 12.5')).toEqual([1180909566, 12]);
    expect(parseCenter('9342.399,16389.73')).toEqual({ x: 9342.399, z: 16389.73 });
    expect(parseCenter('bad')).toBeNull();
    expect(parseCenter('100,100')).toBeNull();
    expect(parseRequestedZoom('1.2')).toBe(1.2);
    expect(parseRequestedZoom('wat')).toBeNull();
    expect(parseRequestedZoom(String(MAP_MIN_ZOOM - 0.1))).toBeNull();
    expect(parseRequestedZoom(String(MAP_MAX_ZOOM + 0.1))).toBeNull();
    expect(
      parseBitcraftQuery('?resourceId=1180909566,12,-1&center=9342.399,16389.73&zoom=1.2'),
    ).toEqual({
      requestedResourceIds: [1180909566, 12],
      requestedCenter: { x: 9342.399, z: 16389.73 },
      requestedZoom: 1.2,
    });
  });

  it('normalizes source labels and live freshness', () => {
    expect(normalizeDisplaySource(PLAYER_DETAIL_LOCATION_SOURCE)).toBe('detail');
    expect(normalizeDisplaySource(BITCRAFT_LIVE_SOURCE)).toBe('live');
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

  it('builds shared Bitcraft endpoints and channels', () => {
    expect(buildMobileEntityStateChannel('648518346354069088')).toBe('mobile_entity_state:648518346354069088');
    expect(buildPlayerDetailUrl('648518346354069088')).toBe(
      'https://bitcraftmap.com/api/players/648518346354069088',
    );
    expect(buildResourceSnapshotUrl(12, 1180909566)).toBe(
      'https://bcmap-api.bitjita.com/region12/resource/1180909566',
    );
  });
});
