import * as z from "zod";
import { SECTIONS, optionSchema, type FieldDefinition } from "@/lib/fields/types";
import { appEventSchema } from "@/lib/external/schemas";

/*
 * Runtime shapes for what we persist. IndexedDB hands back `unknown` (an older
 * app version, a bug, or a user poking DevTools can leave anything there), so
 * every read is validated. Records that fail are skipped, never trusted.
 * Looser than the TypeScript types on purpose: unknown extra keys from a NEWER
 * app version must not make a record unreadable.
 */

const storedError = z.object({
  kind: z.enum([
    "unauthorized",
    "network",
    "permission",
    "invalid",
    "quota",
    "unknown",
  ]),
  message: z.string(),
});

export const localEntrySchema = z.looseObject({
  schemaVersion: z.literal(1),
  key: z.string().min(1),
  id: z.string().min(1),
  eventKey: z.string().min(1),
  teamNumber: z.number().int(),
  payload: z.object({
    answers: z.record(z.string(), z.unknown()),
    rating: z.number().nullable(),
    notes: z.string().nullable(),
    scoutedBy: z.string().nullable(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  event: appEventSchema,
  status: z.enum(["pending", "syncing", "synced", "failed"]),
  attempts: z.number().int().min(0),
  nextAttemptAt: z.number().nullable(),
  lastError: storedError.nullable(),
  serverId: z.string().nullable(),
  serverUpdatedAt: z.string().nullable(),
  entryDirty: z.boolean(),
  superseded: z.boolean(),
  clockAdjusted: z.boolean(),
  revision: z.number().int().min(0),
  claim: z.object({ revision: z.number(), claimedAt: z.number() }).nullable(),
  syncedAt: z.number().nullable(),
});

export const localPhotoSchema = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  eventKey: z.string().min(1),
  teamNumber: z.number().int(),
  entryId: z.string().min(1),
  kind: z.enum(["upload", "removal"]),
  status: z.enum(["pending", "uploading", "uploaded", "failed"]),
  blob: z.instanceof(Blob).nullable(),
  storagePath: z.string().min(1),
  attempts: z.number().int().min(0),
  lastError: storedError.nullable(),
  createdAt: z.string(),
});

export const cacheRecordSchema = z.object({
  value: z.unknown(),
  savedAt: z.number(),
});

export const metaSchemas = {
  pausedForAuth: z.boolean(),
  lastSyncAt: z.number(),
} as const;
export type MetaShape = { [K in keyof typeof metaSchemas]: z.infer<(typeof metaSchemas)[K]> };
export type MetaKey = keyof MetaShape;

// ---------------------------------------------------------------------------
// Schemas for the cached server data (cache.ts). fieldDefinitionSchema mirrors
// FieldDefinition in fields/types.ts; `_FieldSchemaMatches` below makes the
// compiler complain if the two ever drift apart.
// ---------------------------------------------------------------------------

const fieldBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  section: z.enum(SECTIONS),
  sortOrder: z.number().int(),
  archived: z.boolean(),
};

export const fieldDefinitionSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("number"),
    higherIsBetter: z.boolean(),
    goodThreshold: z.number().nullable(),
    badThreshold: z.number().nullable(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("yes_no"),
    goodAnswer: z.boolean().nullable(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("dropdown"),
    options: z.array(optionSchema).min(1),
  }),
  z.object({ ...fieldBase, type: z.literal("text") }),
]);

export const fieldListSchema = z.array(fieldDefinitionSchema);

/** Compile-time check that the runtime schema produces exactly FieldDefinition. */
export type _FieldSchemaMatches = z.infer<typeof fieldDefinitionSchema> extends FieldDefinition
  ? FieldDefinition extends z.infer<typeof fieldDefinitionSchema>
    ? true
    : never
  : never;
