import type { WorldPoint } from '../shared/bitcraft';

export interface QueryState {
  requestedResourceIds: number[];
  requestedCenter: WorldPoint | null;
  requestedZoom: number | null;
}

export interface PlayerRecord {
  username: string;
  entityId: string;
  x: number | null;
  z: number | null;
  regionId: number | null;
  timestamp: number | null;
  source: string | null;
  signedIn: boolean | null;
  lastLoginTimestamp: string | null;
  destinationX?: number | null;
  destinationZ?: number | null;
}

export interface RenderablePlayer extends PlayerRecord {
  x: number;
  z: number;
}
