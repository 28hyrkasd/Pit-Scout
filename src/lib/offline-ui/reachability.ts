import { ApiError } from "@/lib/api/client";
import { classifySaveError } from "@/lib/entries/save-error";

/**
 * "We could not get fresh data" failures, where serving a saved copy is better than an error:
 * our API route unreachable (network) or its upstream (TBA / Statbotics) down. NOT: signed out,
 * not found, or a response we cannot parse.
 */
export function isApiReachabilityError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === "network" || error.kind === "upstream");
}

/** Same idea for direct Supabase reads: only a genuine network failure (not permission, not an expired session). */
export function isSupabaseReachabilityError(error: unknown): boolean {
  return classifySaveError(error).kind === "network";
}
