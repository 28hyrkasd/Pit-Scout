import { classifySaveError } from "@/lib/entries/save-error";
import { ApiError } from "./client";

/**
 * Where to send the scout when a READ failed because the session expired, or null to stay put.
 *
 * Staying put matters when the page holds edits that exist only on screen (`unsaved`):
 * the redirect is a full page load and would throw them away. Edits already saved to this
 * device live in IndexedDB and survive the redirect, so they never block it; and nothing in
 * the sign-out/redirect path clears IndexedDB.
 *
 * Covers both error families: our API routes (ApiError "unauthorized") and direct Supabase
 * reads (a JWT error classified as "unauthorized").
 */
export function loginRedirectUrl(
  error: unknown,
  here: { pathname: string; search: string },
  unsaved: boolean,
): string | null {
  if (unsaved || !error) return null;
  const kind = error instanceof ApiError ? error.kind : classifySaveError(error).kind;
  if (kind !== "unauthorized") return null;
  return `/login?next=${encodeURIComponent(here.pathname + here.search)}`;
}
