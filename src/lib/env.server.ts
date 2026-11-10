import "server-only";
import * as z from "zod";

/**
 * Server-only configuration. Importing this file from a Client Component is a
 * build error (via `server-only`), so these values can never reach the browser.
 *
 * Deliberately absent: SUPABASE_SERVICE_ROLE_KEY. This app does not need it and
 * it must never be added here or given a NEXT_PUBLIC_ prefix.
 */
const serverSchema = z.object({
  /** TBA read API key. Sent as the X-TBA-Auth-Key header, server side only. */
  TBA_API_KEY: z.string().min(1, { error: "TBA_API_KEY is required" }),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverSchema.safeParse({
    TBA_API_KEY: process.env.TBA_API_KEY,
  });
  if (!result.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(result.error)}`);
  }
  cached = result.data;
  return cached;
}
