import { AlertTriangleIcon, CloudUploadIcon, Loader2Icon } from "lucide-react";
import type { SyncBadge } from "@/lib/offline-ui/merge-entries";
import { cn } from "@/lib/utils";

/** "Not synced yet" / "Syncing…" / "Sync failed": icon AND words, so it never relies on color alone. */
export function SyncBadgeView({ badge, className }: { badge: SyncBadge; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        badge.kind === "failed"
          ? "border-destructive/50 text-destructive"
          : "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      {badge.kind === "syncing" ? (
        <Loader2Icon className="size-3 animate-spin" aria-hidden />
      ) : badge.kind === "failed" ? (
        <AlertTriangleIcon className="size-3" aria-hidden />
      ) : (
        <CloudUploadIcon className="size-3" aria-hidden />
      )}
      {badge.text}
    </span>
  );
}
