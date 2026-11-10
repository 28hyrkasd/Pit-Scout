import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import type { Database } from "@/lib/database.types";
import type { Answers } from "@/lib/fields/types";
import type { EntryPayload } from "./payload";
import { classifySaveError, SaveError } from "./save-error";

export type EntryRow = Database["public"]["Tables"]["scouting_entries"]["Row"];

export type UpsertEntryInput = {
  /** Client-generated. The surviving row may have a DIFFERENT id (see below). */
  id: string;
  eventKey: string;
  teamNumber: number;
  payload: EntryPayload;
  /** Creation time of the entry (kept when editing an existing one). */
  createdAt: string;
  /** The last-write-wins clock. Generated on the client at the moment of the edit. */
  updatedAt: string;
};

/** The entry that now exists in the database for (event, team), validated. */
export type SavedEntry = {
  id: string;
  eventKey: string;
  teamNumber: number;
  answers: Answers;
  rating: number | null;
  notes: string | null;
  scoutedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const returnedRowSchema = z.object({
  id: z.string().min(1),
  event_key: z.string().min(1),
  team_number: z.number().int(),
  answers: z.record(z.string(), z.unknown()),
  rating: z.number().int().nullable(),
  notes: z.string().nullable(),
  scouted_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Call upsert_scouting_entry (last-write-wins by updated_at, keyed on event+team).
 *
 * The generated RPC types mark p_notes / p_rating / p_scouted_by as non-null even
 * though the SQL function accepts null (Postgres function arguments carry no
 * nullability, so the generator guesses). The casts live here, in one place,
 * instead of hand-editing database.types.ts, which `npm run db:types` regenerates.
 *
 * IMPORTANT: the returned row is what is stored NOW. Two things can differ from
 * what was sent:
 *  - `id`: if another scout already created this team, the existing row keeps its
 *    id. Anything pointing at the id you generated (photos) must move to this one.
 *  - `updatedAt`: if the stored row is newer, the write was ignored. Compare with
 *    wasApplied() to tell the user their edit did not win.
 */
export async function upsertScoutingEntry(
  client: Pick<SupabaseClient<Database>, "rpc">,
  input: UpsertEntryInput,
): Promise<SavedEntry> {
  const { data, error, status } = await client.rpc("upsert_scouting_entry", {
    p_id: input.id,
    p_event_key: input.eventKey,
    p_team_number: input.teamNumber,
    p_answers: input.payload.answers,
    p_rating: input.payload.rating as unknown as number,
    p_notes: input.payload.notes as unknown as string,
    p_scouted_by: input.payload.scoutedBy as unknown as string,
    p_created_at: input.createdAt,
    p_updated_at: input.updatedAt,
  });
  if (error) throw classifySaveError(error, status);

  const saved = parseEntryRow(data);
  if (!saved)
    throw new SaveError(
      "unknown",
      "The server returned an unexpected response. Please try again.",
    );
  return saved;
}

/** A scouting_entries row (from the RPC or a select) -> SavedEntry, or null if it is not the expected shape. */
export function parseEntryRow(data: unknown): SavedEntry | null {
  const parsed = returnedRowSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    eventKey: row.event_key,
    teamNumber: row.team_number,
    answers: row.answers as Answers,
    rating: row.rating,
    notes: row.notes,
    scoutedBy: row.scouted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Did our write win? Compared as instants, not strings: Postgres returns
 * "2026-11-09T20:00:00+00:00" for what we sent as "2026-11-09T20:00:00.000Z".
 */
export function wasApplied(
  saved: Pick<SavedEntry, "updatedAt">,
  sentUpdatedAt: string,
): boolean {
  return (
    new Date(saved.updatedAt).getTime() === new Date(sentUpdatedAt).getTime()
  );
}
