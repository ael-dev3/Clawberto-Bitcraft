import { z } from 'zod';

const finiteNumber = z.number().finite();
const finiteNumberOrNull = finiteNumber.nullable().optional();
const numericLike = z.union([z.string(), z.number()]);

export const trackedPlayerConfigItemSchema = z.object({
  username: z.string().min(1),
  entityId: z.string().min(1),
});

export const trackedPlayerConfigSchema = z.array(trackedPlayerConfigItemSchema);

export const runtimePlayerCacheSchema = z
  .object({
    username: z.string().min(1),
    entityId: z.string().min(1),
    x: finiteNumberOrNull,
    z: finiteNumberOrNull,
    regionId: z.number().int().positive().nullable().optional(),
    timestamp: finiteNumber.nullable().optional(),
    capturedAt: z.string().nullable().optional(),
    retainedAt: z.string().nullable().optional(),
    source: z.string().min(1).nullable().optional(),
    signedIn: z.boolean().nullable().optional(),
    lastLoginTimestamp: z.string().nullable().optional(),
    destinationX: finiteNumberOrNull,
    destinationZ: finiteNumberOrNull,
  })
  .passthrough();

export const aelRuntimeCacheSchema = runtimePlayerCacheSchema;
export const trackedPlayersRuntimeCacheSchema = z.array(runtimePlayerCacheSchema);

export const playerDetailSchema = z
  .object({
    regionId: z.number().int().positive().nullable().optional(),
    signedIn: z.boolean().nullable().optional(),
    lastLoginTimestamp: z.string().nullable().optional(),
    locationX: finiteNumberOrNull,
    locationZ: finiteNumberOrNull,
    teleportLocationX: finiteNumberOrNull,
    teleportLocationZ: finiteNumberOrNull,
  })
  .passthrough();

export const playerDetailResponseSchema = z
  .object({
    player: playerDetailSchema.nullable().optional(),
  })
  .passthrough();

export const liveMessageEnvelopeSchema = z
  .object({
    type: z.string(),
    channel: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

export const liveStatePayloadSchema = z
  .object({
    entity_id: numericLike.optional(),
    region_id: numericLike.optional(),
    location_x: finiteNumber.optional(),
    location_z: finiteNumber.optional(),
    destination_x: finiteNumber.optional(),
    destination_z: finiteNumber.optional(),
    timestamp: finiteNumber.optional(),
    is_walking: z.boolean().optional(),
  })
  .passthrough();

export const liveStateEventSchema = z
  .object({
    type: z.literal('event'),
    channel: z.string().min(1),
    data: liveStatePayloadSchema,
  })
  .passthrough();

export const resourcePointSchema = z.tuple([finiteNumber, finiteNumber]);

export const resourceFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: z
      .object({
        type: z.literal('MultiPoint'),
        coordinates: z.array(resourcePointSchema),
      })
      .passthrough(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const resourceSnapshotSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(resourceFeatureSchema).min(1),
  })
  .passthrough();

export type AelRuntimeCache = z.infer<typeof aelRuntimeCacheSchema>;
export type LiveStateEvent = z.infer<typeof liveStateEventSchema>;
export type PlayerDetailResponse = z.infer<typeof playerDetailResponseSchema>;
export type ResourceSnapshot = z.infer<typeof resourceSnapshotSchema>;
export type RuntimePlayerCache = z.infer<typeof runtimePlayerCacheSchema>;
export type TrackedPlayerConfigItem = z.infer<typeof trackedPlayerConfigItemSchema>;
