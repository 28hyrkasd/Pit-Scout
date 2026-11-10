import * as z from "zod";
import { appEventSchema, type AppEvent } from "@/lib/external/schemas";

/**
 * The event the scout is currently working on, persisted in localStorage.
 *
 * We store the whole (slim) event object, not just its key, so the header can
 * show the event name immediately and offline, without a network call.
 *
 * localStorage is user-editable and survives app updates, so everything read
 * from it is validated; anything malformed is treated as "no event selected"
 * rather than crashing the app on launch.
 */
export const SELECTED_EVENT_STORAGE_KEY = "pit-scout:selected-event:v1";

const storedSchema = z.object({ version: z.literal(1), event: appEventSchema });

export function parseSelectedEvent(raw: string | null): AppEvent | null {
  if (!raw) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.event : null;
  } catch {
    return null;
  }
}

export function serializeSelectedEvent(event: AppEvent): string {
  return JSON.stringify({ version: 1, event } satisfies z.infer<typeof storedSchema>);
}
