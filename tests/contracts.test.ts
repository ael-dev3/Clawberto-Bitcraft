import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseLiveStateMessage } from '../src/shared/live-state';
import {
  aelRuntimeCacheSchema,
  resourceSnapshotSchema,
  trackedPlayerConfigSchema,
  trackedPlayersRuntimeCacheSchema,
} from '../src/shared/schemas';

describe('runtime contracts', () => {
  it('validates checked-in cache and resource fixtures', async () => {
    const [aelCache, trackedPlayers, trackedConfig, resourceSnapshot] = await Promise.all([
      readFixture('../public/runtime/ael-live.json'),
      readFixture('../public/runtime/tracked-players.json'),
      readFixture('../public/data/tracked-players.json'),
      readFixture('../public/data/resources/12/1180909566.json'),
    ]);

    expect(() => aelRuntimeCacheSchema.parse(aelCache)).not.toThrow();
    expect(() => trackedPlayersRuntimeCacheSchema.parse(trackedPlayers)).not.toThrow();
    expect(() => trackedPlayerConfigSchema.parse(trackedConfig)).not.toThrow();
    expect(() => resourceSnapshotSchema.parse(resourceSnapshot)).not.toThrow();
  });

  it('normalizes live websocket payloads into map coordinates', () => {
    const snapshot = parseLiveStateMessage(
      {
        type: 'event',
        channel: 'mobile_entity_state:648518346354069088',
        data: {
          location_x: 9342399,
          location_z: 16389730,
          region_id: '12',
          timestamp: 1773006059,
          is_walking: true,
        },
      },
      'websocket fixture',
    );

    expect(snapshot).toEqual({
      entityId: '648518346354069088',
      regionId: 12,
      x: 9342.399,
      z: 16389.73,
      destinationX: null,
      destinationZ: null,
      timestamp: 1773006059,
      isWalking: true,
    });
  });
});

async function readFixture(relativePath: string): Promise<unknown> {
  const contents = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return JSON.parse(contents) as unknown;
}
