import { describe, expect, it } from 'vitest';

import {
  PLAYER_DETAIL_LOCATION_SOURCE,
  PLAYER_DETAIL_TELEPORT_SOURCE,
  buildMobileEntityStateChannel,
} from '../src/shared/bitcraft';
import { subscribeMobileEntityState } from '../src/shared/clients/live';
import { normalizePlayerDetailState } from '../src/shared/clients/player-detail';

describe('shared clients', () => {
  it('subscribes sockets to mobile entity state channels', () => {
    const sent: string[] = [];
    subscribeMobileEntityState(
      {
        send(payload) {
          sent.push(payload);
        },
      },
      ['648518346354069088', '123'],
    );

    expect(sent).toEqual([
      JSON.stringify({
        type: 'subscribe',
        channels: [
          buildMobileEntityStateChannel('648518346354069088'),
          buildMobileEntityStateChannel('123'),
        ],
      }),
    ]);
  });

  it('normalizes player detail location data before teleport fallbacks', () => {
    expect(
      normalizePlayerDetailState({
        player: {
          regionId: null,
          locationX: 9342.399,
          locationZ: 16389.73,
          teleportLocationX: 11000,
          teleportLocationZ: 17000,
          signedIn: true,
          lastLoginTimestamp: '2026-03-10T12:00:00.000Z',
        },
      }),
    ).toEqual({
      x: 9342.399,
      z: 16389.73,
      regionId: 12,
      source: PLAYER_DETAIL_LOCATION_SOURCE,
      signedIn: true,
      lastLoginTimestamp: '2026-03-10T12:00:00.000Z',
    });
  });

  it('falls back to teleport coordinates when live location is missing', () => {
    expect(
      normalizePlayerDetailState(
        {
          player: {
            regionId: null,
            locationX: null,
            locationZ: null,
            teleportLocationX: 9342.399,
            teleportLocationZ: 16389.73,
            signedIn: false,
            lastLoginTimestamp: null,
          },
        },
        12,
      ),
    ).toEqual({
      x: 9342.399,
      z: 16389.73,
      regionId: 12,
      source: PLAYER_DETAIL_TELEPORT_SOURCE,
      signedIn: false,
      lastLoginTimestamp: null,
    });
  });
});
