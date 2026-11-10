"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={state?.email}
          aria-invalid={state?.errors?.email ? true : undefined}
          aria-describedby={state?.errors?.email ? "email-error" : undefined}
          className="h-12 text-base"
        />
        {state?.errors?.email ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.errors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state?.errors?.password ? true : undefined}
          aria-describedby={state?.errors?.password ? "password-error" : undefined}
          className="h-12 text-base"
        />
        {state?.errors?.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {state.errors.password[0]}
          </p>
        ) : null}
      </div>

      {state?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-12 text-base">
        {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
