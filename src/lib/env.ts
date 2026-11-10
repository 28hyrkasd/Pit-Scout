import * as z from "zod";

/**
 * Public (browser-safe) configuration.
 *
 * Each NEXT_PUBLIC_* variable MUST be referenced as a literal
 * `process.env.NEXT_PUBLIC_X` expression: Next.js inlines them at build time by
 * textual replacement, so `process.env[name]` would be undefined in the browser.
 *
 * Supabase renamed the "anon" key to a "publishable" key. Both work the same;
 * we accept either name so existing .env files keep working.
 */
const publicSchema = z.object({
  supabaseUrl: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
  supabaseKey: z
    .string({ error: "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)" })
    .min(20, { error: "Supabase key looks too short" }),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export function getPublicEnv(): PublicEnv {
  const result = publicSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!result.success) {
    throw new Error(`Invalid public environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
