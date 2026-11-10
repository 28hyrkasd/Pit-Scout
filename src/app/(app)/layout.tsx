import { Suspense } from "react";
import { ScoutNamePrompt } from "@/components/entries/scout-name-prompt";
import { EventSwitcher } from "@/components/events/event-switcher";
import { SyncAttentionBanner, SyncStatusChip } from "@/components/offline/sync-status";
import { BottomNav, BottomNavFallback } from "@/components/layout/bottom-nav";
import { UserMenu, UserMenuSkeleton } from "@/components/layout/user-menu";
import { InstallPrompt } from "@/components/pwa/install-prompt";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <EventSwitcher />
        <div className="flex shrink-0 items-center gap-1">
          <SyncStatusChip />
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
        </div>
      </header>
      <SyncAttentionBanner />
      <InstallPrompt />
      <main className="flex-1 p-4">{children}</main>
      <Suspense fallback={<BottomNavFallback />}>
        <BottomNav />
      </Suspense>
      <ScoutNamePrompt />
    </div>
  );
}
