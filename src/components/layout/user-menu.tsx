import { LogOutIcon } from "lucide-react";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

/** Shows who is signed in and a sign-out button. Reads the session, so render it inside <Suspense>. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline" title={user.email}>
        {user.email}
      </span>
      <form action={logout}>
        <Button type="submit" variant="ghost" size="icon-lg" className="size-11" aria-label="Sign out">
          <LogOutIcon aria-hidden />
        </Button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" aria-hidden />;
}
