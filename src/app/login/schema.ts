import * as z from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: "Enter your email" })
    .pipe(z.email({ error: "Enter a valid email" })),
  password: z.string().min(1, { error: "Enter your password" }),
});

export type LoginState =
  | {
      /** Field-level validation messages. */
      errors?: { email?: string[]; password?: string[] };
      /** Form-level message (e.g. wrong credentials). */
      message?: string;
      /** Echoed back so the email field survives a failed attempt. */
      email?: string;
    }
  | undefined;
