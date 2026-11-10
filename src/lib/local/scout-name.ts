import * as z from "zod";
import { normalizeScoutName } from "@/lib/entries/payload";

/**
 * The scout's optional "your name", asked once on first launch and saved on every
 * entry as scouted_by. Kept in localStorage: it is a per-device convenience, not
 * account data.
 *
 * `asked` is stored separately from `name` so that skipping the prompt is
 * remembered: a scout who chose "no name" must not be nagged on every launch.
 */
export const SCOUT_NAME_STORAGE_KEY = "pit-scout:scout-name:v1";

export type ScoutNameState = { asked: boolean; name: string | null };

export const DEFAULT_SCOUT_NAME_STATE: ScoutNameState = {
  asked: false,
  name: null,
};

const storedSchema = z.object({
  version: z.literal(1),
  asked: z.boolean(),
  name: z.string().nullable(),
});

/** The slice of the Storage API we use, so tests do not need a browser. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Anything malformed (hand-edited, from a future version) falls back to "not asked yet". */
export function parseScoutName(raw: string | null): ScoutNameState {
  if (!raw) return DEFAULT_SCOUT_NAME_STATE;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SCOUT_NAME_STATE;
    return {
      asked: parsed.data.asked,
      name: normalizeScoutName(parsed.data.name),
    };
  } catch {
    return DEFAULT_SCOUT_NAME_STATE;
  }
}

export function serializeScoutName(state: ScoutNameState): string {
  return JSON.stringify({
    version: 1,
    asked: state.asked,
    name: normalizeScoutName(state.name),
  } satisfies z.infer<typeof storedSchema>);
}

export function loadScoutName(storage: StorageLike): ScoutNameState {
  try {
    return parseScoutName(storage.getItem(SCOUT_NAME_STORAGE_KEY));
  } catch {
    return DEFAULT_SCOUT_NAME_STATE; // storage blocked (Safari private mode)
  }
}

/**
 * Save the answer to the first-launch prompt. A blank name is saved as "asked, no
 * name". Returns the state that was actually saved, or null if storage refused
 * (full / blocked), so the caller can keep it in memory for the session.
 */
export function saveScoutName(
  storage: StorageLike,
  rawName: string | null,
): ScoutNameState | null {
  const state: ScoutNameState = {
    asked: true,
    name: normalizeScoutName(rawName),
  };
  try {
    storage.setItem(SCOUT_NAME_STORAGE_KEY, serializeScoutName(state));
    return state;
  } catch {
    return null;
  }
}
