import type { ConnectivityStatus } from "@/lib/offline/connectivity";
import type { SyncCounts } from "@/lib/offline/local";
import type { SyncPassOutcome } from "@/lib/offline/sync";
import type { LocalEntry } from "@/lib/offline/types";
import { SUPERSEDED_NOTICE } from "./merge-entries";

/*
 * Wording and ordering for the sync indicator and its sheet. Pure: every string the
 * scout reads about "is my data safe" is decided here, so it is unit-tested and
 * never depends on color alone (each state has its own icon key AND text).
 */

export type IndicatorIcon = "online" | "offline" | "unknown" | "syncing" | "auth" | "attention";

export type IndicatorInput = {
  ready: boolean;
  connectivity: ConnectivityStatus;
  counts: Pick<SyncCounts, "pending" | "syncing" | "failed" | "unsynced"> | null;
  pausedForAuth: boolean;
  /** A pass is running right now. */
  syncing: boolean;
  /** false: IndexedDB is unavailable and saves only live in memory. */
  persistent: boolean;
};

export type Indicator = {
  icon: IndicatorIcon;
  /** Chip text, e.g. "Offline · 2 waiting". */
  label: string;
  /** Narrow-screen chip text, e.g. "Offline · 2". Still words, not just an icon. */
  shortLabel: string;
  /** Full sentence for screen readers (role=status, aria-live=polite). */
  announcement: string;
  waiting: number;
  failed: number;
  /** Offer "Sync now". */
  canSyncNow: boolean;
  /** Offer "Sign in again" instead of syncing. */
  needsSignIn: boolean;
  /** Persistent-storage warning to show, or null. */
  storageWarning: string | null;
};

export const STORAGE_WARNING =
  "Offline saving isn't available in this browser. Anything you save is only kept until you close or reload this tab.";

export function connectivityText(status: ConnectivityStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    case "unknown":
      return "Checking connection";
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeIndicator(input: IndicatorInput): Indicator {
  const counts = input.counts;
  const waiting = counts ? counts.pending + counts.syncing : 0;
  const failed = counts?.failed ?? 0;
  const unsynced = counts?.unsynced ?? 0;
  const storageWarning = input.ready && !input.persistent ? STORAGE_WARNING : null;
  const base = { waiting, failed, storageWarning };

  if (input.pausedForAuth) {
    return {
      ...base,
      icon: "auth",
      label: unsynced > 0 ? `Sign in again · ${unsynced} waiting` : "Sign in again",
      shortLabel: "Sign in again",
      announcement: `Your session expired. ${plural(unsynced, "entry", "entries")} saved on this device will sync after you sign in again.`,
      canSyncNow: false,
      needsSignIn: true,
    };
  }

  const parts = [connectivityText(input.connectivity)];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);

  const icon: IndicatorIcon =
    input.syncing ? "syncing" : failed > 0 ? "attention" : input.connectivity;

  let announcement = connectivityText(input.connectivity) + ".";
  if (input.syncing) announcement += " Syncing now.";
  if (unsynced === 0) announcement += " All your scouting is synced.";
  else {
    if (waiting > 0) announcement += ` ${plural(waiting, "entry", "entries")} saved on this device, not synced yet.`;
    if (failed > 0) announcement += ` ${plural(failed, "entry", "entries")} failed to sync.`;
  }

  return {
    ...base,
    icon,
    label: input.syncing ? ["Syncing", ...parts.slice(1)].join(" · ") : parts.join(" · "),
    shortLabel: `${input.syncing ? "Syncing" : connectivityText(input.connectivity)}${waiting + failed > 0 ? ` · ${waiting + failed}` : ""}`,
    announcement,
    canSyncNow: unsynced > 0 && !input.syncing,
    needsSignIn: false,
    storageWarning,
  };
}

// ---------------------------------------------------------------------------
// The sheet: which entries to list and how to describe each
// ---------------------------------------------------------------------------

/** Entries worth listing: anything not safely on the server, plus synced ones whose version lost. Failed first, then oldest edit. */
export function selectSheetEntries(entries: readonly LocalEntry[]): LocalEntry[] {
  const rank = (e: LocalEntry) => (e.status === "failed" ? 0 : e.status === "synced" ? 2 : 1);
  return entries
    .filter((e) => e.status !== "synced" || e.superseded)
    .sort((a, b) => rank(a) - rank(b) || a.updatedAt.localeCompare(b.updatedAt) || a.teamNumber - b.teamNumber);
}

export type EntryRowView = {
  key: string;
  teamNumber: number;
  statusText: string;
  /** Last error (already a user-safe sentence from classifySaveError), only for failed entries. */
  errorText: string | null;
  attemptsText: string | null;
  supersededNote: string | null;
  /** Failed entries get a Retry button. */
  canRetry: boolean;
  /** Visual weight only; the text carries the meaning. */
  tone: "neutral" | "warning" | "error";
};

export function describeEntryRow(entry: LocalEntry): EntryRowView {
  const supersededNote = entry.superseded ? SUPERSEDED_NOTICE : null;
  const attemptsText = entry.attempts > 0 ? `Tried ${plural(entry.attempts, "time")}` : null;
  const base = { key: entry.key, teamNumber: entry.teamNumber, supersededNote };

  switch (entry.status) {
    case "synced":
      return { ...base, statusText: "Synced", errorText: null, attemptsText: null, canRetry: false, tone: "neutral" };
    case "syncing":
      return { ...base, statusText: "Syncing…", errorText: null, attemptsText, canRetry: false, tone: "neutral" };
    case "pending":
      return { ...base, statusText: "Not synced yet", errorText: null, attemptsText, canRetry: false, tone: "warning" };
    case "failed":
      return {
        ...base,
        statusText: entry.nextAttemptAt === null ? "Sync failed" : "Not synced yet (will retry)",
        errorText: entry.lastError?.message ?? null,
        attemptsText,
        canRetry: true,
        tone: entry.nextAttemptAt === null ? "error" : "warning",
      };
  }
}

/**
 * "Last synced 9:03 PM" from a ms timestamp, or null when nothing ever synced. Takes the
 * timestamp (never reads the clock), so it is safe in render; only call it in client output
 * since the viewer's time zone differs from the server's.
 */
export function formatClockTime(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** "Nov 9, 9:03 PM" for the 'Showing saved data from …' banner. */
export function formatSavedAt(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(ms),
  );
}

/** The banner text for data served from the device cache, or null when the data is fresh. */
export function cachedDataMessage(cachedAt: number | null | undefined): string | null {
  const when = formatSavedAt(cachedAt);
  if (cachedAt === null || cachedAt === undefined) return null;
  return when ? `Showing saved data from ${when}` : "Showing saved data";
}

/** The older of the cache times in play (the banner should be honest about the stalest thing on screen); null when nothing is cached. */
export function oldestCachedAt(...values: (number | null | undefined)[]): number | null {
  const times = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return times.length === 0 ? null : Math.min(...times);
}

/** How the last pass ended, for the sheet; null when there is nothing worth saying. */
export function describeLastOutcome(outcome: SyncPassOutcome | null): string | null {
  switch (outcome) {
    case "network-error":
      return "Couldn't reach the server. Your entries are safe on this device and will sync when the connection is back.";
    case "storage-error":
      return "This device had trouble reading its saved scouting. Free up some space and try again.";
    case "paused-auth":
      return "Your session expired. Sign in again to finish syncing.";
    default:
      return null;
  }
}
