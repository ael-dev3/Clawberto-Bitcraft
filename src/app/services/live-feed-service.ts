import { LIVE_WS } from '../../config';
import { parseLiveStateMessage, type LiveStateSnapshot } from '../../shared/live-state';
import { isFiniteNumber } from '../../shared/bitcraft';

export interface LiveFeedHandlers {
  onOpen: () => void;
  onLiveState: (liveState: LiveStateSnapshot) => void;
  onClose: () => void;
  onError: () => void;
}

export class LiveFeedService {
  connect(entityIds: string[], handlers: LiveFeedHandlers): WebSocket {
    const ws = new WebSocket(LIVE_WS);

    ws.addEventListener('open', () => {
      const channels = entityIds.map((entityId) => `mobile_entity_state:${entityId}`);
      ws.send(JSON.stringify({ type: 'subscribe', channels }));
      handlers.onOpen();
    });

    ws.addEventListener('message', (event) => {
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

      handlers.onLiveState(liveState);
    });

    ws.addEventListener('close', handlers.onClose);
    ws.addEventListener('error', handlers.onError);

    return ws;
  }
}
