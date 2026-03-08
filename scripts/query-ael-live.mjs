const entityId = process.argv[2] || '648518346354069088';
const ws = new WebSocket('wss://live.bitjita.com');

console.log(`subscribing to mobile_entity_state:${entityId}`);

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: [`mobile_entity_state:${entityId}`] }));
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'event' || !msg.data) {
    console.log(JSON.stringify(msg));
    return;
  }
  const data = msg.data;
  const out = {
    entityId: data.entity_id,
    regionId: data.region_id,
    x: typeof data.location_x === 'number' ? data.location_x / 1000 : null,
    z: typeof data.location_z === 'number' ? data.location_z / 1000 : null,
    destinationX: typeof data.destination_x === 'number' ? data.destination_x / 1000 : null,
    destinationZ: typeof data.destination_z === 'number' ? data.destination_z / 1000 : null,
    timestamp: data.timestamp,
  };
  console.log(JSON.stringify(out, null, 2));
});

ws.addEventListener('close', (event) => {
  console.error(`closed code=${event.code} reason=${event.reason}`);
});

ws.addEventListener('error', (event) => {
  console.error('websocket error', event);
});
