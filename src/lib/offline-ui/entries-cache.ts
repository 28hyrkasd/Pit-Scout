import * as z from "zod";
import type { SavedEntry } from "@/lib/entries/rpc";

/*
 * What the offline cache holds for scouting data that other scouts wrote. (Fields,
 * teams and EPA keys/schemas come from @/lib/offline cacheKeys/cacheSchemas.)
 * Same rules as the core cache: bumping the `:v1` suffix orphans old shapes, and a
 * stored value that no longer parses is discarded on read.
 */

const EVENT_KEY = /^[0-9]{4}[a-z0-9]+$/;
const UUID_LIKE = /^[0-9a-fA-F-]{8,64}$/;

export const entriesCacheKeys = {
  /** Every server entry for an event (the team list). */
  eventEntries: (eventKey: string) => {
    if (!EVENT_KEY.test(eventKey)) throw new Error("Invalid event key");
    return `entries:${eventKey}:v1`;
  },
  /** The photo records (not signed URLs, which expire) of one entry. */
  entryPhotos: (entryId: string) => {
    if (!UUID_LIKE.test(entryId)) throw new Error("Invalid entry id");
    return `photos:${entryId}:v1`;
  },
} as const;

const savedEntrySchema = z.object({
  id: z.string().min(1),
  eventKey: z.string().min(1),
  teamNumber: z.number().int(),
  answers: z.record(z.string(), z.unknown()),
  rating: z.number().nullable(),
  notes: z.string().nullable(),
  scoutedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// zod infers `unknown` answer values; SavedEntry narrows them. The data was valid
// when it was written, and every reader tolerates stale answers (rateAnswer/formatAnswer).
export const savedEntryListSchema = z.array(savedEntrySchema) as unknown as z.ZodType<SavedEntry[]>;

export type CachedPhotoRecord = { id: string; storagePath: string };
export const photoRecordListSchema = z.array(z.object({ id: z.string().min(1), storagePath: z.string().min(1) }));

/** The entry for one team out of the cached event list, or null when the list has no row for it. */
export function findTeamEntry(entries: readonly SavedEntry[], teamNumber: number): SavedEntry | null {
  let best: SavedEntry | null = null;
  for (const entry of entries) {
    if (entry.teamNumber !== teamNumber) continue;
    if (!best || Date.parse(entry.updatedAt) > Date.parse(best.updatedAt)) best = entry;
  }
  return best;
}
