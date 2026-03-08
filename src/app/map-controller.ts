import { APOTHEM, FIXED_REGION_ID, MAP_SIZE } from '../config';
import { fixedRegionBounds, isInsideFixedRegion, regionIdFromCoord, type WorldPoint } from '../shared/bitcraft';
import { escapeHtml } from '../shared/strings';
import type { RenderablePlayer } from './types';

declare const L: any;

interface LabelPosition {
  dx: number;
  dy: number;
}

export class MapController {
  private readonly regionBounds: [[number, number], [number, number]] = [
    [fixedRegionBounds.zMin, fixedRegionBounds.xMin],
    [fixedRegionBounds.zMax, fixedRegionBounds.xMax],
  ];

  private readonly map: any;
  private readonly terrainLayer: any;
  private readonly regionLayer = L.layerGroup();
  private readonly resourceLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private readonly playerDotLayer = L.layerGroup();
  private readonly playerLabelLayer = L.layerGroup();
  private readonly resourceRenderer = L.canvas({ padding: 0.5 });

  private manualMarker: any | null = null;
  private readonly playerDotMarkers = new Map<string, any>();
  private readonly playerLabelMarkers = new Map<string, any>();
  private lastRenderablePlayers: RenderablePlayer[] = [];

  constructor(private readonly terrainUrl: string) {
    const crs = L.extend({}, L.CRS.Simple, {
      projection: {
        project(latlng: { lat: number; lng: number }) {
          return new L.Point(latlng.lng, -latlng.lat / APOTHEM);
        },
        unproject(point: { x: number; y: number }) {
          return new L.LatLng(-point.y * APOTHEM, point.x);
        },
        bounds: L.bounds([0, 0], [MAP_SIZE, MAP_SIZE]),
      },
      transformation: new L.Transformation(1, 0, 1, 0),
      scale(zoom: number) {
        return 2 ** zoom;
      },
      infinite: false,
    });

    this.map = L.map('map', {
      crs,
      preferCanvas: true,
      zoomAnimation: false,
      attributionControl: false,
      zoomControl: true,
      boxZoom: false,
      minZoom: -2,
      maxZoom: 5,
      zoomSnap: 0.1,
      maxBounds: this.regionBounds,
      maxBoundsViscosity: 1,
    });

    this.terrainLayer = L.imageOverlay(this.terrainUrl, this.regionBounds, {
      crossOrigin: true,
      opacity: 1,
    });

    this.terrainLayer.addTo(this.map);
    this.regionLayer.addTo(this.map);
    this.resourceLayer.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.playerDotLayer.addTo(this.map);
    this.playerLabelLayer.addTo(this.map);

    this.map.on('zoomend', () => {
      if (this.lastRenderablePlayers.length > 0) {
        this.renderPlayers(this.lastRenderablePlayers);
      }
    });
  }

  applyInitialView(requestedCenter: WorldPoint | null, requestedZoom: number | null): void {
    if (requestedCenter && requestedZoom != null && isInsideFixedRegion(requestedCenter)) {
      this.map.setView([requestedCenter.z, requestedCenter.x], requestedZoom);
      return;
    }

    this.map.fitBounds(this.regionBounds, { padding: [24, 24] });
  }

  drawRegionFrame(): void {
    this.regionLayer.clearLayers();
    const rect = L.rectangle(this.regionBounds, {
      color: '#63d2ff',
      weight: 2,
      fillColor: '#63d2ff',
      fillOpacity: 0.04,
    });
    rect.bindTooltip(`Region ${FIXED_REGION_ID}`, {
      permanent: true,
      direction: 'center',
      className: 'region-label',
    });
    rect.addTo(this.regionLayer);
  }

  async verifyTerrainImage(): Promise<boolean> {
    const image = new Image();
    return new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = this.terrainUrl;
    });
  }

  recenter(point: WorldPoint, minZoom = 1.2): void {
    this.map.setView([point.z, point.x], Math.max(this.map.getZoom(), minZoom), { animate: false });
  }

  setManualPin(point: WorldPoint): void {
    const popupHtml = `Manual pin<br>X ${point.x.toFixed(3)}<br>Z ${point.z.toFixed(3)}<br>Region ${regionIdFromCoord(point.x, point.z) ?? 'unknown'}`;

    if (!this.manualMarker) {
      this.manualMarker = L.marker([point.z, point.x], {
        icon: L.divIcon({
          className: 'manual-marker',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      });
      this.manualMarker.addTo(this.markerLayer);
    }

    this.manualMarker.setLatLng([point.z, point.x]);
    this.manualMarker.bindPopup(popupHtml);
  }

  clearManualPin(): void {
    if (!this.manualMarker) return;
    this.markerLayer.removeLayer(this.manualMarker);
    this.manualMarker = null;
  }

  addResourcePoints(points: WorldPoint[]): number {
    let renderedCount = 0;
    for (const point of points) {
      if (!isInsideFixedRegion(point)) continue;
      L.circleMarker([point.z, point.x], {
        renderer: this.resourceRenderer,
        radius: 2.6,
        weight: 0,
        fillOpacity: 0.65,
        fillColor: '#ffcc66',
      }).addTo(this.resourceLayer);
      renderedCount += 1;
    }
    return renderedCount;
  }

  renderPlayers(players: RenderablePlayer[]): void {
    this.lastRenderablePlayers = [...players];
    const zoom = this.map.getZoom();
    const labelLayout = getLabelLayout(zoom);
    const labelPositions = buildLabelPositions(players, labelLayout);
    const seen = new Set<string>();

    for (const player of players) {
      const entityId = String(player.entityId);
      seen.add(entityId);

      let dotMarker = this.playerDotMarkers.get(entityId);
      if (!dotMarker) {
        dotMarker = L.marker([player.z, player.x], {
          icon: L.divIcon({
            className: '',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            html: '<div class="friend-marker-hitbox"><div class="friend-marker-dot"></div></div>',
          }),
        });
        this.playerDotMarkers.set(entityId, dotMarker);
        dotMarker.addTo(this.playerDotLayer);
      }

      dotMarker.setLatLng([player.z, player.x]);
      dotMarker.bindPopup(buildPopupHtml(player));

      const labelState = labelPositions.get(entityId) ?? { dx: 0, dy: -labelLayout.baseLift };
      const labelIcon = L.divIcon({
        className: 'friend-marker-label-icon',
        iconSize: [240, 180],
        iconAnchor: [120, 90],
        html: `<div class="friend-marker-label-wrap" style="transform: translate(${labelState.dx}px, ${labelState.dy}px)"><div class="friend-marker-label">${escapeHtml(player.username)}</div></div>`,
      });

      let labelMarker = this.playerLabelMarkers.get(entityId);
      if (!labelMarker) {
        labelMarker = L.marker([player.z, player.x], {
          interactive: true,
          keyboard: true,
          zIndexOffset: 1000,
          icon: labelIcon,
        });
        this.playerLabelMarkers.set(entityId, labelMarker);
        labelMarker.addTo(this.playerLabelLayer);
      }

      labelMarker.setLatLng([player.z, player.x]);
      labelMarker.setIcon(labelIcon);
      labelMarker.bindPopup(buildPopupHtml(player));
    }

    for (const [entityId, marker] of this.playerDotMarkers.entries()) {
      if (seen.has(entityId)) continue;
      this.playerDotLayer.removeLayer(marker);
      this.playerDotMarkers.delete(entityId);
    }

    for (const [entityId, marker] of this.playerLabelMarkers.entries()) {
      if (seen.has(entityId)) continue;
      this.playerLabelLayer.removeLayer(marker);
      this.playerLabelMarkers.delete(entityId);
    }
  }

  fitToPlayers(players: RenderablePlayer[]): void {
    const points = players.map((player) => [player.z, player.x] as [number, number]);
    if (points.length >= 2) {
      this.map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 1.2 });
      return;
    }

    if (points.length === 1) {
      this.map.setView(points[0], 1.2);
    }
  }

  getZoom(): number {
    return this.map.getZoom();
  }
}

function buildPopupHtml(player: RenderablePlayer): string {
  const source = player.source ?? 'unknown';
  const region = player.regionId ?? 'unknown';
  return `${escapeHtml(player.username)}<br>X ${player.x.toFixed(3)}<br>Z ${player.z.toFixed(3)}<br>Region ${region}<br>Source ${escapeHtml(source)}`;
}

interface LabelLayout {
  baseLift: number;
  rowGap: number;
  columnSpread: number;
}

function getLabelLayout(zoom: number): LabelLayout {
  const clamped = Math.max(-2, Math.min(5, zoom));
  const t = (clamped + 2) / 7;
  const eased = 1 - (1 - t) ** 2;

  return {
    baseLift: lerp(58, 20, eased),
    rowGap: lerp(28, 18, eased),
    columnSpread: lerp(78, 34, eased),
  };
}

function buildLabelPositions(players: RenderablePlayer[], layout: LabelLayout): Map<string, LabelPosition> {
  const groups = new Map<string, RenderablePlayer[]>();

  for (const player of players) {
    const key = `${player.x.toFixed(3)}:${player.z.toFixed(3)}`;
    const group = groups.get(key);
    if (group) {
      group.push(player);
    } else {
      groups.set(key, [player]);
    }
  }

  const positions = new Map<string, LabelPosition>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.username.localeCompare(right.username));

    if (group.length === 1) {
      const onlyPlayer = group[0];
      if (!onlyPlayer) continue;
      positions.set(String(onlyPlayer.entityId), { dx: 0, dy: -layout.baseLift });
      continue;
    }

    const useTwoColumns = group.length >= 8;
    const xOffsets = useTwoColumns ? [-layout.columnSpread, layout.columnSpread] : [0];

    for (let index = 0; index < group.length; index += 1) {
      const player = group[index];
      if (!player) continue;
      const column = useTwoColumns ? index % 2 : 0;
      const row = useTwoColumns ? Math.floor(index / 2) : index;
      positions.set(String(player.entityId), {
        dx: xOffsets[column] ?? 0,
        dy: -layout.baseLift - row * layout.rowGap,
      });
    }
  }

  return positions;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
