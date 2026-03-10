import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMobileEntityStateChannel } from '../src/shared/bitcraft';
import { LiveFeedService, type LiveFeedHandlers, type LiveFeedSocket } from '../src/app/services/live-feed-service';

describe('live feed service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reconnects with exponential backoff between failed attempts', () => {
    vi.useFakeTimers();

    const sockets = createSocketFactory();
    const service = new LiveFeedService({
      socketFactory: sockets.factory,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      reconnectJitterRatio: 0,
      staleTimeoutMs: 60_000,
    });

    service.connect(['648518346354069088'], createHandlers());

    expect(sockets.created).toHaveLength(1);

    getCreatedSocket(sockets.created, 0).emitClose();
    vi.advanceTimersByTime(999);
    expect(sockets.created).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(sockets.created).toHaveLength(2);

    getCreatedSocket(sockets.created, 1).emitClose();
    vi.advanceTimersByTime(1_999);
    expect(sockets.created).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(sockets.created).toHaveLength(3);
  });

  it('resubscribes after reconnecting and forwards live updates', () => {
    vi.useFakeTimers();

    const sockets = createSocketFactory();
    const handlers = createHandlers();
    const service = new LiveFeedService({
      socketFactory: sockets.factory,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      reconnectJitterRatio: 0,
      staleTimeoutMs: 60_000,
    });

    service.connect(['648518346354069088', '123'], handlers);

    const firstSocket = getCreatedSocket(sockets.created, 0);
    firstSocket.emitOpen();

    expect(firstSocket.sent).toEqual([expectedSubscriptionPayload(['648518346354069088', '123'])]);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);

    firstSocket.emitClose();
    vi.advanceTimersByTime(1_000);

    const secondSocket = getCreatedSocket(sockets.created, 1);
    secondSocket.emitOpen();

    expect(secondSocket.sent).toEqual([expectedSubscriptionPayload(['648518346354069088', '123'])]);
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);

    secondSocket.emitMessage(
      JSON.stringify({
        type: 'event',
        channel: buildMobileEntityStateChannel('648518346354069088'),
        data: {
          location_x: 9_342_399,
          location_z: 16_389_730,
          is_walking: true,
        },
      }),
    );

    expect(handlers.onLiveState).toHaveBeenCalledWith({
      entityId: '648518346354069088',
      regionId: null,
      x: 9342.399,
      z: 16389.73,
      destinationX: null,
      destinationZ: null,
      timestamp: null,
      isWalking: true,
    });
  });

  it('closes stale sockets, reconnects, and stops reconnecting after dispose', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const sockets = createSocketFactory();
    const handlers = createHandlers();
    const service = new LiveFeedService({
      socketFactory: sockets.factory,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      reconnectJitterRatio: 0,
      staleTimeoutMs: 5_000,
    });

    const connection = service.connect(['648518346354069088'], handlers);
    const firstSocket = getCreatedSocket(sockets.created, 0);
    firstSocket.emitOpen();

    vi.advanceTimersByTime(4_999);
    expect(firstSocket.closeCalls).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(warnSpy).toHaveBeenCalledWith('Live websocket stale, reconnecting');
    expect(firstSocket.closeCalls).toEqual([[4000, 'stale']]);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    expect(sockets.created).toHaveLength(2);

    const secondSocket = getCreatedSocket(sockets.created, 1);
    secondSocket.emitOpen();
    connection.dispose();

    expect(secondSocket.closeCalls).toEqual([[1000, 'disposed']]);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(sockets.created).toHaveLength(2);
  });
});

function expectedSubscriptionPayload(entityIds: string[]): string {
  return JSON.stringify({
    type: 'subscribe',
    channels: entityIds.map((entityId) => buildMobileEntityStateChannel(entityId)),
  });
}

function createHandlers(): LiveFeedHandlers {
  return {
    onOpen: vi.fn(),
    onLiveState: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  };
}

function createSocketFactory(): {
  created: FakeLiveSocket[];
  factory: () => LiveFeedSocket;
} {
  const created: FakeLiveSocket[] = [];

  return {
    created,
    factory: () => {
      const socket = new FakeLiveSocket();
      created.push(socket);
      return socket;
    },
  };
}

function getCreatedSocket(sockets: FakeLiveSocket[], index: number): FakeLiveSocket {
  const socket = sockets[index];
  expect(socket).toBeDefined();
  return socket!;
}

class FakeLiveSocket implements LiveFeedSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly closeCalls: Array<[number | undefined, string | undefined]> = [];
  private readonly listeners = {
    open: [] as Array<() => void>,
    message: [] as Array<(event: { data: unknown }) => void>,
    close: [] as Array<() => void>,
    error: [] as Array<() => void>,
  };

  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (() => void) | ((event: { data: unknown }) => void),
  ): void {
    if (type === 'message') {
      this.listeners.message.push(listener as (event: { data: unknown }) => void);
      return;
    }

    if (type === 'open') {
      this.listeners.open.push(listener as () => void);
      return;
    }

    if (type === 'close') {
      this.listeners.close.push(listener as () => void);
      return;
    }

    this.listeners.error.push(listener as () => void);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = 2;
    this.emitClose();
  }

  emitOpen(): void {
    this.readyState = 1;
    for (const listener of [...this.listeners.open]) {
      listener();
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of [...this.listeners.message]) {
      listener({ data });
    }
  }

  emitClose(): void {
    this.readyState = 3;
    for (const listener of [...this.listeners.close]) {
      listener();
    }
  }
}
