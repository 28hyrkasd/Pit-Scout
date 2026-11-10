import { Suspense } from "react";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Pit Scout</CardTitle>
          <CardDescription>Sign in with your team email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* searchParams is request-time data; keep it behind Suspense so the
              card shell above can be prerendered. */}
          <Suspense fallback={<LoginForm />}>
            <LoginFormWithNext searchParams={props.searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function LoginFormWithNext({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validate here too (the action re-validates): never reflect an unsafe value.
  const next = raw ? safeRedirectPath(raw) : undefined;
  return <LoginForm next={next === "/" ? undefined : next} />;
}
