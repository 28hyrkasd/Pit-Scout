import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type AppUser = {
  /** auth.users.id (the `sub` claim). Matches scouting_entries.created_by. */
  id: string;
  email: string;
};

/**
 * Returns the verified signed-in user, or null.
 *
 * Uses getClaims(), which verifies the JWT signature, instead of getSession():
 * the session cookie can be forged, so its contents must never be trusted on the
 * server. cache() dedupes the verification within a single request.
 *
 * There are no roles: every signed-in user can do everything in the app.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  // getClaims() reads Date.now() to check token expiry, which Next rejects during prerendering
  // (cacheComponents). Opt out of prerendering here so every caller is request-time only.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  };
});

/**
 * Use at the top of Server Actions, Route Handlers and Server Components that
 * touch data. The proxy redirects unauthenticated page navigations, but it is
 * not a security boundary on its own (see the note in proxy.ts).
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
