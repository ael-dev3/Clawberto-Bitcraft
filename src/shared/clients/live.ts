import { BITCRAFT_LIVE_WS_URL, buildMobileEntityStateChannel } from '../bitcraft';

interface SocketSender {
  send(payload: string): void;
}

export function createBitcraftLiveSocket(): WebSocket {
  return new WebSocket(BITCRAFT_LIVE_WS_URL);
}

export function subscribeMobileEntityState(socket: SocketSender, entityIds: Iterable<string>): void {
  socket.send(
    JSON.stringify({
      type: 'subscribe',
      channels: Array.from(entityIds, (entityId) => buildMobileEntityStateChannel(entityId)),
    }),
  );
}
