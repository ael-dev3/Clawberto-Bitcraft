import { coerceOptionalNumber, extractEntityId } from './bitcraft';
import type { LiveStateEvent } from './schemas';
import { liveMessageEnvelopeSchema, liveStateEventSchema } from './schemas';
import { validateWithSchema } from './validation';

export interface LiveStateSnapshot {
  entityId: string | null;
  regionId: number | null;
  x: number | null;
  z: number | null;
  destinationX: number | null;
  destinationZ: number | null;
  timestamp: number | null;
  isWalking: boolean;
}

export function parseLiveStateMessage(value: unknown, label: string): LiveStateSnapshot | null {
  const envelope = validateWithSchema(value, liveMessageEnvelopeSchema, label);
  if (!envelope || envelope.type !== 'event' || !envelope.channel || envelope.data == null) {
    return null;
  }

  const liveEvent = validateWithSchema(envelope, liveStateEventSchema, label);
  if (!liveEvent) return null;
  return normalizeLiveStateEvent(liveEvent);
}

export function normalizeLiveStateEvent(event: LiveStateEvent): LiveStateSnapshot {
  const { channel, data } = event;
  return {
    entityId: data.entity_id != null ? String(data.entity_id) : extractEntityId(channel),
    regionId: coerceOptionalNumber(data.region_id),
    x: typeof data.location_x === 'number' ? data.location_x / 1000 : null,
    z: typeof data.location_z === 'number' ? data.location_z / 1000 : null,
    destinationX: typeof data.destination_x === 'number' ? data.destination_x / 1000 : null,
    destinationZ: typeof data.destination_z === 'number' ? data.destination_z / 1000 : null,
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : null,
    isWalking: data.is_walking === true,
  };
}
