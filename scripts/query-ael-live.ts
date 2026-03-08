import { parseLiveStateMessage } from '../src/shared/live-state';

const entityId = process.argv[2] || '648518346354069088';
const ws = new WebSocket('wss://live.bitjita.com');

console.log(`subscribing to mobile_entity_state:${entityId}`);

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: [`mobile_entity_state:${entityId}`] }));
});

ws.addEventListener('message', (event) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data) as unknown;
  } catch (error) {
    console.error('invalid websocket message', error);
    return;
  }

  const liveState = parseLiveStateMessage(parsed, 'Ael live websocket payload');
  if (!liveState) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  console.log(JSON.stringify(liveState, null, 2));
});

ws.addEventListener('close', (event) => {
  console.error(`closed code=${event.code} reason=${event.reason}`);
});

ws.addEventListener('error', (event) => {
  console.error('websocket error', event);
});
