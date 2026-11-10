import { Suspense } from "react";
import { EventSwitcher } from "@/components/events/event-switcher";
import { BottomNav } from "@/components/layout/bottom-nav";
import { UserMenu, UserMenuSkeleton } from "@/components/layout/user-menu";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <EventSwitcher />
        <Suspense fallback={<UserMenuSkeleton />}>
          <UserMenu />
        </Suspense>
      </header>
      <main className="flex-1 p-4">{children}</main>
      <BottomNav />
    </div>
  );
}
