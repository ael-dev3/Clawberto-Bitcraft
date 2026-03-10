import { DEFAULT_PLAYER, FIXED_REGION_ID } from '../../config';
import { isFiniteNumber, isInsideFixedRegion, regionIdFromCoord, type WorldPoint } from '../../shared/bitcraft';
import type { LiveStateSnapshot } from '../../shared/live-state';
import { normalizeDisplaySource, shouldKeepFreshLiveState } from '../../shared/player-source';
import type { AelRuntimeCache, RuntimePlayerCache, TrackedPlayerConfigItem } from '../../shared/schemas';
import { decideLiveUpdateTrust, type PendingLiveCandidate } from '../live-trust';
import type { PlayerRecord, RenderablePlayer } from '../types';

export interface AelPositionUpdate {
  x: number;
  z: number;
  regionId?: number | null;
  timestamp?: number | null;
  source?: string | null;
  signedIn?: boolean | null;
  lastLoginTimestamp?: string | null;
  destinationX?: number | null;
  destinationZ?: number | null;
}

export interface LiveApplyResult {
  accepted: boolean;
  kind: 'ael' | 'tracked' | 'ignored';
  reason?: 'off-map' | 'pending';
  isWalking?: boolean;
}

export class PlayerStore {
  private readonly trackedPlayers = new Map<string, PlayerRecord>();
  private readonly pendingLiveCandidates = new Map<string, PendingLiveCandidate>();

  private aelKnown = false;
  private aelState: PlayerRecord | null = null;

  hydrateTrackedPlayers(configRows: TrackedPlayerConfigItem[], runtimeRows: RuntimePlayerCache[]): void {
    const runtimeById = new Map(runtimeRows.map((row) => [String(row.entityId), row]));

    this.trackedPlayers.clear();
    for (const player of configRows) {
      this.trackedPlayers.set(player.entityId, this.mergePlayerConfig(player, runtimeById.get(player.entityId)));
    }
  }

  hydrateAelFromRuntimeCache(cache: AelRuntimeCache | null, preserveFreshLive: boolean): boolean {
    if (!cache || !isFiniteNumber(cache.x) || !isFiniteNumber(cache.z)) {
      return false;
    }

    if (preserveFreshLive && shouldKeepFreshLiveState(this.aelState)) {
      return false;
    }

    this.setAelPosition({
      x: cache.x,
      z: cache.z,
      regionId: cache.regionId ?? regionIdFromCoord(cache.x, cache.z),
      timestamp: cache.timestamp ?? null,
      source: normalizeDisplaySource(cache.source),
      signedIn: cache.signedIn ?? true,
      lastLoginTimestamp: cache.lastLoginTimestamp ?? null,
    });

    return true;
  }

  refreshTrackedPlayersFromRuntimeRows(rows: RuntimePlayerCache[]): boolean {
    let changed = false;

    for (const row of rows) {
      const entityId = String(row.entityId);
      const current = this.trackedPlayers.get(entityId);
      if (!current || shouldKeepFreshLiveState(current)) {
        continue;
      }

      this.updateTrackedPlayer(entityId, {
        x: row.x ?? current.x,
        z: row.z ?? current.z,
        regionId: row.regionId ?? current.regionId,
        timestamp: row.timestamp ?? current.timestamp,
        source: normalizeDisplaySource(row.source),
        signedIn: row.signedIn ?? current.signedIn,
        lastLoginTimestamp: row.lastLoginTimestamp ?? current.lastLoginTimestamp,
        destinationX: row.destinationX ?? current.destinationX ?? null,
        destinationZ: row.destinationZ ?? current.destinationZ ?? null,
      });
      changed = true;
    }

    return changed;
  }

  applyLiveSnapshot(liveState: LiveStateSnapshot): LiveApplyResult {
    if (!liveState.entityId || !isFiniteNumber(liveState.x) || !isFiniteNumber(liveState.z)) {
      return { accepted: false, kind: 'ignored' };
    }

    const livePoint = { x: liveState.x, z: liveState.z };
    if (!isInsideFixedRegion(livePoint)) {
      return { accepted: false, kind: 'ignored', reason: 'off-map' };
    }

    const currentPlayer = this.getPlayerByEntityId(liveState.entityId);
    const trustDecision = decideLiveUpdateTrust(
      liveState.entityId,
      currentPlayer,
      liveState,
      this.pendingLiveCandidates.get(liveState.entityId) ?? null,
    );

    if (trustDecision.nextPending) {
      this.pendingLiveCandidates.set(liveState.entityId, trustDecision.nextPending);
    } else {
      this.pendingLiveCandidates.delete(liveState.entityId);
    }

    if (!trustDecision.accept) {
      return { accepted: false, kind: 'ignored', reason: 'pending' };
    }

    if (liveState.entityId === DEFAULT_PLAYER.entityId) {
      this.setAelPosition({
        x: liveState.x,
        z: liveState.z,
        regionId: liveState.regionId ?? regionIdFromCoord(liveState.x, liveState.z),
        timestamp: liveState.timestamp,
        source: 'live',
        signedIn: true,
        destinationX: liveState.destinationX,
        destinationZ: liveState.destinationZ,
      });
      return { accepted: true, kind: 'ael', isWalking: liveState.isWalking };
    }

    if (!this.trackedPlayers.has(liveState.entityId)) {
      return { accepted: false, kind: 'ignored' };
    }

    this.updateTrackedPlayer(liveState.entityId, {
      x: liveState.x,
      z: liveState.z,
      regionId: liveState.regionId ?? regionIdFromCoord(liveState.x, liveState.z),
      timestamp: liveState.timestamp,
      source: 'live',
      signedIn: true,
      destinationX: liveState.destinationX,
      destinationZ: liveState.destinationZ,
    });

    return { accepted: true, kind: 'tracked', isWalking: liveState.isWalking };
  }

  getAelState(): PlayerRecord | null {
    return this.aelState;
  }

  isAelKnown(): boolean {
    return this.aelKnown;
  }

  getTrackedPlayerCount(): number {
    return this.trackedPlayers.size;
  }

  getTrackedPlayers(): PlayerRecord[] {
    return Array.from(this.trackedPlayers.values());
  }

  getTrackedPlayerEntityIds(): string[] {
    return Array.from(this.trackedPlayers.keys());
  }

  getKnownAelPoint(): WorldPoint | null {
    if (!this.aelState || !isFiniteNumber(this.aelState.x) || !isFiniteNumber(this.aelState.z)) {
      return null;
    }

    return { x: this.aelState.x, z: this.aelState.z };
  }

  getRenderablePlayers(): RenderablePlayer[] {
    const players: RenderablePlayer[] = [];

    const ael = this.toRenderablePlayer(this.aelState);
    if (ael) {
      players.push(ael);
    }

    for (const player of this.trackedPlayers.values()) {
      const renderable = this.toRenderablePlayer(player);
      if (renderable) {
        players.push(renderable);
      }
    }

    return players.sort((left, right) => left.username.localeCompare(right.username));
  }

  private mergePlayerConfig(player: TrackedPlayerConfigItem, runtimeRow?: RuntimePlayerCache): PlayerRecord {
    return {
      username: player.username,
      entityId: player.entityId,
      x: runtimeRow?.x ?? null,
      z: runtimeRow?.z ?? null,
      regionId: runtimeRow?.regionId ?? null,
      timestamp: runtimeRow?.timestamp ?? null,
      source: normalizeDisplaySource(runtimeRow?.source),
      signedIn: runtimeRow?.signedIn ?? null,
      lastLoginTimestamp: runtimeRow?.lastLoginTimestamp ?? null,
      destinationX: runtimeRow?.destinationX ?? null,
      destinationZ: runtimeRow?.destinationZ ?? null,
    };
  }

  private updateTrackedPlayer(entityId: string, patch: Partial<PlayerRecord>): void {
    const previous = this.trackedPlayers.get(entityId) ?? this.createFallbackPlayer(entityId);

    this.trackedPlayers.set(entityId, {
      ...previous,
      ...patch,
      entityId,
      username: patch.username ?? previous.username,
      source: patch.source ?? previous.source,
    });
  }

  private setAelPosition(next: AelPositionUpdate): void {
    const regionId = next.regionId ?? regionIdFromCoord(next.x, next.z);

    this.aelState = {
      username: DEFAULT_PLAYER.username,
      entityId: DEFAULT_PLAYER.entityId,
      x: next.x,
      z: next.z,
      regionId,
      timestamp: next.timestamp ?? null,
      source: next.source ?? 'unknown',
      signedIn: next.signedIn ?? true,
      lastLoginTimestamp: next.lastLoginTimestamp ?? this.aelState?.lastLoginTimestamp ?? null,
      destinationX: next.destinationX ?? null,
      destinationZ: next.destinationZ ?? null,
    };
    this.aelKnown = true;
  }

  private getPlayerByEntityId(entityId: string): PlayerRecord | null {
    if (entityId === DEFAULT_PLAYER.entityId) {
      return this.aelState;
    }

    return this.trackedPlayers.get(entityId) ?? null;
  }

  private toRenderablePlayer(player: PlayerRecord | null): RenderablePlayer | null {
    if (!player || !isFiniteNumber(player.x) || !isFiniteNumber(player.z)) {
      return null;
    }

    const point = { x: player.x, z: player.z };
    const regionId = player.regionId ?? regionIdFromCoord(player.x, player.z);
    if (regionId !== FIXED_REGION_ID || !isInsideFixedRegion(point)) {
      return null;
    }

    return {
      ...player,
      x: point.x,
      z: point.z,
      regionId,
    };
  }

  private createFallbackPlayer(entityId: string): PlayerRecord {
    return {
      username: entityId,
      entityId,
      x: null,
      z: null,
      regionId: null,
      timestamp: null,
      source: null,
      signedIn: null,
      lastLoginTimestamp: null,
      destinationX: null,
      destinationZ: null,
    };
  }
}
