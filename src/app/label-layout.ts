import type { RenderablePlayer } from './types';

export interface LabelPosition {
  dx: number;
  dy: number;
}

export interface LabelLayout {
  baseLift: number;
  rowGap: number;
  columnSpread: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const LABEL_HEIGHT = 26;
const VIEWPORT_PADDING = 10;

export function getLabelLayout(zoom: number): LabelLayout {
  const clamped = Math.max(-2, Math.min(5, zoom));
  const t = (clamped + 2) / 7;
  const eased = 1 - (1 - t) ** 2;

  return {
    baseLift: lerp(72, 20, eased),
    rowGap: lerp(34, 18, eased),
    columnSpread: lerp(118, 34, eased),
  };
}

export function buildReactiveLabelPositions(
  players: RenderablePlayer[],
  anchorPoints: Map<string, ScreenPoint>,
  viewport: { width: number; height: number },
  zoom: number,
): Map<string, LabelPosition> {
  const layout = getLabelLayout(zoom);
  const placedRects: ScreenRect[] = [];
  const positions = new Map<string, LabelPosition>();

  const ordered = [...players]
    .filter((player) => anchorPoints.has(String(player.entityId)))
    .sort((left, right) => {
      const leftPoint = anchorPoints.get(String(left.entityId))!;
      const rightPoint = anchorPoints.get(String(right.entityId))!;
      if (leftPoint.y !== rightPoint.y) return rightPoint.y - leftPoint.y;
      if (leftPoint.x !== rightPoint.x) return leftPoint.x - rightPoint.x;
      return left.username.localeCompare(right.username);
    });

  for (const player of ordered) {
    const entityId = String(player.entityId);
    const anchor = anchorPoints.get(entityId);
    if (!anchor) continue;

    const labelWidth = estimateLabelWidth(player.username);
    const position = pickBestLabelPosition(anchor, labelWidth, layout, placedRects, viewport);
    positions.set(entityId, position);

    placedRects.push(
      toRect(
        anchor.x + position.dx,
        anchor.y + position.dy,
        labelWidth,
        LABEL_HEIGHT,
      ),
    );
  }

  return positions;
}

export function estimateLabelWidth(username: string): number {
  return clamp(72 + username.length * 7.2, 92, 196);
}

function pickBestLabelPosition(
  anchor: ScreenPoint,
  labelWidth: number,
  layout: LabelLayout,
  placedRects: ScreenRect[],
  viewport: { width: number; height: number },
): LabelPosition {
  const columns = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8].map(
    (multiplier) => multiplier * layout.columnSpread,
  );
  let best: { position: LabelPosition; score: number } | null = null;

  for (let row = 0; row < 18; row += 1) {
    for (const dx of columns) {
      const dy = -layout.baseLift - row * layout.rowGap;
      const rect = toRect(anchor.x + dx, anchor.y + dy, labelWidth, LABEL_HEIGHT);
      const overlapArea = placedRects.reduce((sum, existing) => sum + rectOverlapArea(rect, existing), 0);
      const viewportPenalty = computeViewportPenalty(rect, viewport);
      const score = overlapArea * 100_000 + viewportPenalty * 1_000 + row * 160 + Math.abs(dx) * 0.12;

      if (!best || score < best.score) {
        best = { position: { dx, dy }, score };
      }

      if (overlapArea === 0 && viewportPenalty === 0 && dx === 0) {
        return { dx, dy };
      }
    }
  }

  return best?.position ?? { dx: 0, dy: -layout.baseLift };
}

function toRect(centerX: number, centerY: number, width: number, height: number): ScreenRect {
  return {
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: centerY - height / 2,
    bottom: centerY + height / 2,
  };
}

function rectOverlapArea(left: ScreenRect, right: ScreenRect): number {
  const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return overlapWidth * overlapHeight;
}

function computeViewportPenalty(rect: ScreenRect, viewport: { width: number; height: number }): number {
  const leftOverflow = Math.max(0, VIEWPORT_PADDING - rect.left);
  const rightOverflow = Math.max(0, rect.right - (viewport.width - VIEWPORT_PADDING));
  const topOverflow = Math.max(0, VIEWPORT_PADDING - rect.top);
  const bottomOverflow = Math.max(0, rect.bottom - (viewport.height - VIEWPORT_PADDING));
  return leftOverflow + rightOverflow + topOverflow + bottomOverflow;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
