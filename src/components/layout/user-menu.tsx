import { SignOutButton } from "@/components/layout/sign-out-button";
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
      {/* Client component: asks first when this device still holds unsynced scouting. */}
      <SignOutButton />
    </div>
  );
}

export function UserMenuSkeleton() {
  return <div className="h-11 w-24 animate-pulse rounded-lg bg-muted" aria-hidden />;
}
