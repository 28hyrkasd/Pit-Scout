import { createClient } from "@/lib/supabase/client";
import type { AppEvent } from "@/lib/external/schemas";

/**
 * Make sure the event exists in the `events` table, because
 * scouting_entries.event_key has a foreign key to it.
 *
 * Returns true if saved. A failure (offline, venue wifi) is not fatal: the
 * caller still selects the event locally, and the offline sync in Phase 8 sends
 * the event row together with the entries that need it.
 *
 * `onConflict: key` + a full row means picking the same event twice is harmless.
 */
export async function saveEventToDatabase(event: AppEvent): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase.from("events").upsert(
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
    return !error;
  } catch {
    return false;
  }
}
