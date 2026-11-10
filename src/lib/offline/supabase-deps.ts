import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { upsertScoutingEntry } from "@/lib/entries/rpc";
import { classifySaveError } from "@/lib/entries/save-error";
import type { AppEvent } from "@/lib/external/schemas";
import {
  deletePhotoObject,
  deletePhotoRow,
  insertPhotoRow,
  uploadPhotoObject,
} from "@/lib/photos/storage";
import type { SyncDeps } from "./sync";

type Client = Pick<SupabaseClient<Database>, "rpc" | "from" | "storage">;

/**
 * Upsert the events row, throwing a classified SaveError on failure (unlike
 * saveEventToDatabase, which swallows errors because the online UI can carry on
 * without it; the sync cannot: the entry's foreign key needs this row).
 * `onConflict: key` + a full row makes repeating it harmless.
 */
export async function upsertEventRow(
  client: Pick<Client, "from">,
  event: AppEvent,
): Promise<void> {
  const { error, status } = await client.from("events").upsert(
    {
      key: event.key,
      name: event.name,
      year: event.year,
      start_date: event.startDate,
      end_date: event.endDate,
      city: event.city,
      state_prov: event.stateProv,
      country: event.country,
    },
    { onConflict: "key" },
  );
  if (error) throw classifySaveError(error, status);
}

/**
 * The real SyncDeps, built from the existing helpers. Idempotency of each:
 *  - ensureEvent:     upsert on the primary key.
 *  - upsertEntry:     upsert_scouting_entry (same id + same updatedAt = no-op).
 *  - uploadPhoto:     upsert:false + "already exists" treated as success.
 *  - insertPhotoRow:  unique violation (23505) treated as success.
 *  - deletePhotoRow:  deleting a missing row matches 0 rows, no error.
 *  - deletePhotoObject: removing a missing object is not an error.
 * Pass the browser client from createClient() (src/lib/supabase/client.ts).
 */
export function createSupabaseSyncDeps(client: Client): SyncDeps {
  return {
    ensureEvent: (event) => upsertEventRow(client, event),
    upsertEntry: (input) => upsertScoutingEntry(client, input),
    uploadPhoto: (path, blob) => uploadPhotoObject(client, path, blob),
    insertPhotoRow: (row) => insertPhotoRow(client, row),
    deletePhotoRow: (id) => deletePhotoRow(client, id),
    deletePhotoObject: (path) => deletePhotoObject(client, path),
  };
}
