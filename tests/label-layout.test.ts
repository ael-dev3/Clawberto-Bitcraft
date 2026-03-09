import { describe, expect, it } from 'vitest';

import { buildReactiveLabelPositions, estimateLabelWidth } from '../src/app/label-layout';
import type { RenderablePlayer } from '../src/app/types';

describe('reactive label layout', () => {
  it('stacks nearby labels without overlap', () => {
    const players: RenderablePlayer[] = [
      makePlayer('ael', 'Ael', 100, 100),
      makePlayer('jer', 'Jericcho', 101, 100.2),
      makePlayer('pin', 'PinkCrayon', 101.3, 100.1),
    ];

    const anchorPoints = new Map([
      ['ael', { x: 400, y: 300 }],
      ['jer', { x: 408, y: 302 }],
      ['pin', { x: 414, y: 306 }],
    ]);

    const positions = buildReactiveLabelPositions(players, anchorPoints, { width: 1200, height: 800 }, 1.5);

    const rects = players.map((player) => {
      const anchor = anchorPoints.get(player.entityId)!;
      const offset = positions.get(player.entityId)!;
      const width = estimateLabelWidth(player.username);
      return {
        left: anchor.x + offset.dx - width / 2,
        right: anchor.x + offset.dx + width / 2,
        top: anchor.y + offset.dy - 13,
        bottom: anchor.y + offset.dy + 13,
      };
    });

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  it('pulls labels closer at higher zoom', () => {
    const player = makePlayer('ael', 'Ael', 100, 100);
    const anchors = new Map([['ael', { x: 400, y: 300 }]]);

    const lowZoom = buildReactiveLabelPositions([player], anchors, { width: 1200, height: 800 }, -2).get('ael');
    const highZoom = buildReactiveLabelPositions([player], anchors, { width: 1200, height: 800 }, 2).get('ael');

    expect(lowZoom).toBeTruthy();
    expect(highZoom).toBeTruthy();
    expect(Math.abs(highZoom!.dy)).toBeLessThan(Math.abs(lowZoom!.dy));
  });
});

function makePlayer(entityId: string, username: string, x: number, z: number): RenderablePlayer {
  return {
    entityId,
    username,
    x,
    z,
    regionId: 12,
    timestamp: null,
    source: 'detail',
    signedIn: true,
    lastLoginTimestamp: null,
    destinationX: null,
    destinationZ: null,
  };
}

function overlaps(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number },
): boolean {
  return !(left.right <= right.left || left.left >= right.right || left.bottom <= right.top || left.top >= right.bottom);
}
