import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/** Supabase client for Client Components. The session lives in cookies. */
export function createClient() {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
