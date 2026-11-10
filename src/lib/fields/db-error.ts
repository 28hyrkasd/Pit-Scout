/**
 * Postgres / PostgREST error -> a message a user can act on.
 * Never returns raw SQL, constraint names, or table names.
 */
export function describeDbError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";

  // Permission / row-level security.
  if (code === "42501") return "You don't have permission to change fields.";
  // CHECK constraint (the form should catch these first; this is the backstop).
  if (code === "23514") return "Those settings aren't allowed. Check the thresholds and options.";
  // Unique violation.
  if (code === "23505") return "A field like that already exists.";
  // Numeric value out of range.
  if (code === "22003") return "One of the numbers is too large.";
  // JWT expired / invalid.
  if (code === "PGRST301" || code === "PGRST303") return "Your session expired. Please sign in again.";
  // fetch() failed: offline, DNS, captive portal.
  if (/fetch|network|failed to|load failed|timeout/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return "Something went wrong saving that. Please try again.";
}
