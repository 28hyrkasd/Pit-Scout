import { DatabaseIcon } from "lucide-react";
import { cachedDataMessage } from "@/lib/offline-ui/sync-status";

/**
 * A quiet "Showing saved data from Nov 9, 9:03 PM" line, only when the data on screen came from this
 * device's cache (cachedAt is a ms timestamp) and not fresh from the server (null/undefined).
 * Formats a given timestamp, never reads the clock; render it only from client-fetched data.
 */
export function CachedDataNotice({ cachedAt, className }: { cachedAt: number | null | undefined; className?: string }) {
  const message = cachedDataMessage(cachedAt);
  if (!message) return null;
  return (
    <p role="status" className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}>
      <DatabaseIcon className="size-3.5 shrink-0" aria-hidden />
      {message}. It will refresh when you&apos;re back online.
    </p>
  );
}
