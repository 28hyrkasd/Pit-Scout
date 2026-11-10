"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { loginSchema, type LoginState } from "./schema";

const GENERIC_FAILURE = "Incorrect email or password.";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const parsed = loginSchema.safeParse({
    email: rawEmail,
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      errors: z.flattenError(parsed.error).fieldErrors,
      email: typeof rawEmail === "string" ? rawEmail : undefined,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Small delay slows password guessing from a single client. Supabase also
    // rate-limits sign-ins per IP. The message is deliberately generic so it does
    // not reveal whether an email exists.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const isNetwork = error.name === "AuthRetryableFetchError" || error.status === 0;
    return {
      message: isNetwork
        ? "Can't reach the server. Check your connection and try again."
        : GENERIC_FAILURE,
      email: parsed.data.email,
    };
  }

  const next = safeRedirectPath(formData.get("next")?.toString());
  redirect(next);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
