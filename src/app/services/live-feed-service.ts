import { createBitcraftLiveSocket, subscribeMobileEntityState } from '../../shared/clients/live';
import { parseLiveStateMessage, type LiveStateSnapshot } from '../../shared/live-state';
import { isFiniteNumber } from '../../shared/bitcraft';

const SOCKET_CLOSING = 2;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;
const DEFAULT_STALE_TIMEOUT_MS = 180_000;
const DISPOSE_CLOSE_CODE = 1000;
const STALE_CLOSE_CODE = 4000;
const ERROR_CLOSE_CODE = 4001;

export interface LiveFeedHandlers {
  onOpen: () => void;
  onLiveState: (liveState: LiveStateSnapshot) => void;
  onClose: () => void;
  onError: () => void;
}

export interface LiveFeedConnection {
  dispose(): void;
}

export interface LiveFeedSocketMessageEvent {
  data: unknown;
}

export interface LiveFeedSocket {
  readonly readyState: number;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: LiveFeedSocketMessageEvent) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

interface LiveFeedServiceOptions {
  socketFactory?: () => LiveFeedSocket;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  random?: () => number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectJitterRatio?: number;
  staleTimeoutMs?: number;
}

interface ReconnectingLiveFeedConnectionOptions {
  socketFactory: () => LiveFeedSocket;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  random: () => number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectJitterRatio: number;
  staleTimeoutMs: number;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

export class LiveFeedService {
  constructor(private readonly options: LiveFeedServiceOptions = {}) {}

  connect(entityIds: string[], handlers: LiveFeedHandlers): LiveFeedConnection {
    const connection = new ReconnectingLiveFeedConnection(entityIds, handlers, {
      socketFactory: this.options.socketFactory ?? createBitcraftLiveSocket,
      setTimeoutFn:
        this.options.setTimeoutFn ??
        (((handler: TimerHandler, timeout?: number) => globalThis.setTimeout(handler, timeout)) as typeof setTimeout),
      clearTimeoutFn:
        this.options.clearTimeoutFn ??
        (((handle: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(handle)) as typeof clearTimeout),
      random: this.options.random ?? Math.random,
      reconnectBaseDelayMs: this.options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
      reconnectMaxDelayMs: this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
      reconnectJitterRatio: this.options.reconnectJitterRatio ?? DEFAULT_RECONNECT_JITTER_RATIO,
      staleTimeoutMs: this.options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS,
    });

    connection.connect();
    return connection;
  }
}

class ReconnectingLiveFeedConnection implements LiveFeedConnection {
  private socket: LiveFeedSocket | null = null;
  private reconnectTimer: TimeoutHandle | null = null;
  private staleTimer: TimeoutHandle | null = null;
  private reconnectAttempts = 0;
  private socketToken = 0;
  private disposed = false;

  constructor(
    private readonly entityIds: string[],
    private readonly handlers: LiveFeedHandlers,
    private readonly options: ReconnectingLiveFeedConnectionOptions,
  ) {}

  connect(): void {
    this.openSocket();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearReconnectTimer();
    this.clearStaleTimer();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < SOCKET_CLOSING) {
      safeCloseSocket(socket, DISPOSE_CLOSE_CODE, 'disposed');
    }
  }

  private openSocket(): void {
    if (this.disposed) {
      return;
    }

    this.clearReconnectTimer();

    const socket = this.options.socketFactory();
    const socketToken = ++this.socketToken;
    this.socket = socket;

    this.armStaleTimer(socket, socketToken);

    socket.addEventListener('open', () => {
      if (!this.isCurrentSocket(socket, socketToken)) {
        return;
      }

      this.reconnectAttempts = 0;
      this.armStaleTimer(socket, socketToken);
      subscribeMobileEntityState(socket, this.entityIds);
      this.handlers.onOpen();
    });

    socket.addEventListener('message', (event) => {
      if (!this.isCurrentSocket(socket, socketToken)) {
        return;
      }

      this.armStaleTimer(socket, socketToken);

      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as unknown;
      } catch (error) {
        console.warn('Failed to parse websocket message', error);
        return;
      }

      const liveState = parseLiveStateMessage(parsed, 'Live websocket payload');
      if (!liveState || !liveState.entityId || !isFiniteNumber(liveState.x) || !isFiniteNumber(liveState.z)) {
        return;
      }

      this.handlers.onLiveState(liveState);
    });

    socket.addEventListener('close', () => {
      if (!this.isCurrentSocket(socket, socketToken)) {
        return;
      }

      this.socket = null;
      this.clearStaleTimer();

      if (this.disposed) {
        return;
      }

      this.handlers.onClose();
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      if (!this.isCurrentSocket(socket, socketToken) || this.disposed) {
        return;
      }

      this.handlers.onError();
      if (socket.readyState < SOCKET_CLOSING) {
        safeCloseSocket(socket, ERROR_CLOSE_CODE, 'error');
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }

    const attempt = ++this.reconnectAttempts;
    const delay = computeReconnectDelay(attempt, this.options);
    this.reconnectTimer = this.options.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private armStaleTimer(socket: LiveFeedSocket, socketToken: number): void {
    this.clearStaleTimer();
    this.staleTimer = this.options.setTimeoutFn(() => {
      this.staleTimer = null;

      if (!this.isCurrentSocket(socket, socketToken) || this.disposed) {
        return;
      }

      if (socket.readyState >= SOCKET_CLOSING) {
        return;
      }

      console.warn('Live websocket stale, reconnecting');
      safeCloseSocket(socket, STALE_CLOSE_CODE, 'stale');
    }, this.options.staleTimeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer == null) {
      return;
    }

    this.options.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearStaleTimer(): void {
    if (this.staleTimer == null) {
      return;
    }

    this.options.clearTimeoutFn(this.staleTimer);
    this.staleTimer = null;
  }

  private isCurrentSocket(socket: LiveFeedSocket, socketToken: number): boolean {
    return this.socket === socket && this.socketToken === socketToken;
  }
}

function computeReconnectDelay(
  attempt: number,
  options: Pick<
    ReconnectingLiveFeedConnectionOptions,
    'random' | 'reconnectBaseDelayMs' | 'reconnectMaxDelayMs' | 'reconnectJitterRatio'
  >,
): number {
  const exponentialDelay = Math.min(options.reconnectMaxDelayMs, options.reconnectBaseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitterWindow = Math.max(0, Math.round(exponentialDelay * options.reconnectJitterRatio));
  return Math.min(options.reconnectMaxDelayMs, exponentialDelay + Math.round(jitterWindow * options.random()));
}

function safeCloseSocket(socket: LiveFeedSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    socket.close();
  }
}
