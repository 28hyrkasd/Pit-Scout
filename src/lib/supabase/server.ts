import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Create one per request; never share across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = getPublicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot write cookies. This is
          // fine: proxy.ts refreshes the session and writes the cookies.
        }
      },
    },
  });
}
