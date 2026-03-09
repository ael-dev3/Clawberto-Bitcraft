import {
  CRS,
  Canvas,
  DivIcon,
  ImageOverlay,
  LatLng,
  LayerGroup,
  Map as LeafletMap,
  Point,
  Transformation,
  bounds,
  circleMarker,
  divIcon,
  imageOverlay,
  latLngBounds,
  layerGroup,
  map,
  marker,
  rectangle,
  type CRS as LeafletCrs,
  type DivIconOptions,
  type Layer,
  type LatLngBoundsExpression,
  type PointExpression,
} from 'leaflet';

import { APOTHEM, FIXED_REGION_ID, MAP_SIZE } from '../config';
import { fixedRegionBounds, isInsideFixedRegion, regionIdFromCoord, type WorldPoint } from '../shared/bitcraft';
import { escapeHtml } from '../shared/strings';
import { buildReactiveLabelPositions, estimateLabelWidth, getLabelLayout } from './label-layout';
import type { RenderablePlayer } from './types';

type WorldLatLng = [z: number, x: number];

export class MapController {
  private readonly regionBounds: LatLngBoundsExpression = [
    [fixedRegionBounds.zMin, fixedRegionBounds.xMin],
    [fixedRegionBounds.zMax, fixedRegionBounds.xMax],
  ];

  private readonly map: LeafletMap;
  private readonly terrainLayer: ImageOverlay;
  private readonly regionLayer: LayerGroup = layerGroup();
  private readonly resourceLayer: LayerGroup = layerGroup();
  private readonly markerLayer: LayerGroup = layerGroup();
  private readonly playerDotLayer: LayerGroup = layerGroup();
  private readonly playerLabelLayer: LayerGroup = layerGroup();
  private readonly resourceRenderer: Canvas = new Canvas({ padding: 0.5 });

  private manualMarker: ReturnType<typeof marker> | null = null;
  private readonly playerDotMarkers = new globalThis.Map<string, ReturnType<typeof marker>>();
  private readonly playerLabelMarkers = new globalThis.Map<string, ReturnType<typeof marker>>();
  private lastRenderablePlayers: RenderablePlayer[] = [];

  constructor(private readonly terrainUrl: string) {
    const crs = this.createWorldCrs();

    this.map = map('map', {
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

    this.terrainLayer = imageOverlay(this.terrainUrl, this.regionBounds, {
      crossOrigin: true,
      opacity: 1,
    });

    this.terrainLayer.addTo(this.map);
    this.regionLayer.addTo(this.map);
    this.resourceLayer.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.playerDotLayer.addTo(this.map);
    this.playerLabelLayer.addTo(this.map);

    const rerenderLabels = () => {
      if (this.lastRenderablePlayers.length > 0) {
        this.renderPlayers(this.lastRenderablePlayers);
      }
    };

    this.map.on('zoomend', rerenderLabels);
    this.map.on('moveend', rerenderLabels);
    this.map.on('resize', rerenderLabels);
  }

  applyInitialView(requestedCenter: WorldPoint | null, requestedZoom: number | null): void {
    if (requestedCenter && requestedZoom != null && isInsideFixedRegion(requestedCenter)) {
      this.map.setView(this.toLatLng(requestedCenter), requestedZoom);
      return;
    }

    this.map.fitBounds(this.regionBounds, { padding: [24, 24] });
  }

  drawRegionFrame(): void {
    this.regionLayer.clearLayers();
    const rect = rectangle(this.regionBounds, {
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
    this.map.setView(this.toLatLng(point), Math.max(this.map.getZoom(), minZoom), { animate: false });
  }

  setManualPin(point: WorldPoint): void {
    const popupHtml = `Manual pin<br>X ${point.x.toFixed(3)}<br>Z ${point.z.toFixed(3)}<br>Region ${regionIdFromCoord(point.x, point.z) ?? 'unknown'}`;

    if (!this.manualMarker) {
      this.manualMarker = marker(this.toLatLng(point), {
        icon: divIcon({
          className: 'manual-marker',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      });
      this.manualMarker.addTo(this.markerLayer);
    }

    this.manualMarker.setLatLng(this.toLatLng(point));
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
      circleMarker(this.toLatLng(point), {
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
    const viewportSize = this.map.getSize();
    const labelPositions = buildReactiveLabelPositions(
      players,
      new globalThis.Map(players.map((player) => [String(player.entityId), this.map.latLngToContainerPoint(this.toLatLng(player))])),
      { width: viewportSize.x, height: viewportSize.y },
      zoom,
    );
    const seen = new Set<string>();

    for (const player of players) {
      const entityId = String(player.entityId);
      seen.add(entityId);
      const playerLatLng = this.toLatLng(player);

      let dotMarker = this.playerDotMarkers.get(entityId);
      if (!dotMarker) {
        dotMarker = marker(playerLatLng, {
          icon: this.createDivIcon({
            className: '',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            html: '<div class="friend-marker-hitbox"><div class="friend-marker-dot"></div></div>',
          }),
        });
        this.playerDotMarkers.set(entityId, dotMarker);
        dotMarker.addTo(this.playerDotLayer);
      }

      dotMarker.setLatLng(playerLatLng);
      dotMarker.bindPopup(buildPopupHtml(player));

      const labelState = labelPositions.get(entityId) ?? { dx: 0, dy: -labelLayout.baseLift };
      const labelWidth = estimateLabelWidth(player.username);
      const labelIcon = this.createDivIcon({
        className: 'friend-marker-label-icon',
        iconSize: [260, 220],
        iconAnchor: [130, 110],
        html: `<div class="friend-marker-label-wrap" style="transform: translate(${labelState.dx}px, ${labelState.dy}px)"><div class="friend-marker-label" style="width:${labelWidth}px">${escapeHtml(player.username)}</div></div>`,
      });

      let labelMarker = this.playerLabelMarkers.get(entityId);
      if (!labelMarker) {
        labelMarker = marker(playerLatLng, {
          interactive: true,
          keyboard: true,
          zIndexOffset: 1000,
          icon: labelIcon,
        });
        this.playerLabelMarkers.set(entityId, labelMarker);
        labelMarker.addTo(this.playerLabelLayer);
      }

      labelMarker.setLatLng(playerLatLng);
      labelMarker.setIcon(labelIcon);
      labelMarker.bindPopup(buildPopupHtml(player));
    }

    this.pruneRemovedMarkers(this.playerDotMarkers, this.playerDotLayer, seen);
    this.pruneRemovedMarkers(this.playerLabelMarkers, this.playerLabelLayer, seen);
  }

  fitToPlayers(players: RenderablePlayer[]): void {
    const points = players.map((player) => this.toLatLng(player));
    if (points.length >= 2) {
      this.map.fitBounds(latLngBounds(points), { padding: [80, 80], maxZoom: 1.2 });
      return;
    }

    if (points.length === 1 && points[0]) {
      this.map.setView(points[0], 1.2);
    }
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  private createWorldCrs(): LeafletCrs {
    return Object.assign({}, CRS.Simple, {
      projection: {
        project(latlng: LatLng): Point {
          return new Point(latlng.lng, -latlng.lat / APOTHEM);
        },
        unproject(point: PointExpression): LatLng {
          const { x, y } = point instanceof Point ? point : new Point(point[0], point[1]);
          return new LatLng(-y * APOTHEM, x);
        },
        bounds: bounds([0, 0], [MAP_SIZE, MAP_SIZE]),
      },
      transformation: new Transformation(1, 0, 1, 0),
      scale(zoom: number): number {
        return 2 ** zoom;
      },
      infinite: false,
    }) as LeafletCrs;
  }

  private createDivIcon(options: DivIconOptions): DivIcon {
    return divIcon(options);
  }

  private toLatLng(point: WorldPoint): WorldLatLng {
    return [point.z, point.x];
  }

  private pruneRemovedMarkers(markers: globalThis.Map<string, ReturnType<typeof marker>>, layer: LayerGroup, seen: Set<string>): void {
    for (const [entityId, instance] of markers.entries()) {
      if (seen.has(entityId)) continue;
      layer.removeLayer(instance as Layer);
      markers.delete(entityId);
    }
  }
}

function buildPopupHtml(player: RenderablePlayer): string {
  const source = player.source ?? 'unknown';
  const region = player.regionId ?? 'unknown';
  return `${escapeHtml(player.username)}<br>X ${player.x.toFixed(3)}<br>Z ${player.z.toFixed(3)}<br>Region ${region}<br>Source ${escapeHtml(source)}`;
}
