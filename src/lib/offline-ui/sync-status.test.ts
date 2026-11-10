import { describe, expect, it } from "vitest";
import type { LocalEntry } from "@/lib/offline/types";
import {
  STORAGE_WARNING,
  cachedDataMessage,
  connectivityText,
  describeEntryRow,
  describeIndicator,
  describeLastOutcome,
  oldestCachedAt,
  formatClockTime,
  formatSavedAt,
  selectSheetEntries,
  type IndicatorInput,
} from "./sync-status";

const counts = (c: Partial<{ pending: number; syncing: number; failed: number }> = {}) => {
  const pending = c.pending ?? 0;
  const syncing = c.syncing ?? 0;
  const failed = c.failed ?? 0;
  return { pending, syncing, failed, unsynced: pending + syncing + failed };
};

const input = (over: Partial<IndicatorInput> = {}): IndicatorInput => ({
  ready: true,
  connectivity: "online",
  counts: counts(),
  pausedForAuth: false,
  syncing: false,
  persistent: true,
  ...over,
});

describe("connectivityText", () => {
  it("has text for each status (never color alone)", () => {
    expect(connectivityText("online")).toBe("Online");
    expect(connectivityText("offline")).toBe("Offline");
    expect(connectivityText("unknown")).toBe("Checking connection");
  });
});

describe("describeIndicator", () => {
  it("online and fully synced", () => {
    const i = describeIndicator(input());
    expect(i).toMatchObject({ icon: "online", label: "Online", shortLabel: "Online", canSyncNow: false, needsSignIn: false, storageWarning: null });
    expect(i.announcement).toContain("All your scouting is synced");
  });

  it("offline with waiting and failed entries shows both counts", () => {
    const i = describeIndicator(input({ connectivity: "offline", counts: counts({ pending: 2, syncing: 1, failed: 1 }) }));
    expect(i.label).toBe("Offline · 3 waiting · 1 failed");
    expect(i.icon).toBe("attention");
    expect(i.canSyncNow).toBe(true);
    expect(i.announcement).toMatch(/3 entries saved on this device/);
    expect(i.announcement).toMatch(/1 entry failed/);
  });

  it("offline with only waiting entries keeps the offline icon", () => {
    const i = describeIndicator(input({ connectivity: "offline", counts: counts({ pending: 1 }) }));
    expect(i.icon).toBe("offline");
    expect(i.label).toBe("Offline · 1 waiting");
  });

  it("unknown connectivity says so in text", () => {
    expect(describeIndicator(input({ connectivity: "unknown" })).label).toBe("Checking connection");
  });

  it("syncing shows the spinner icon, replaces the connectivity word, and disables Sync now", () => {
    const i = describeIndicator(input({ syncing: true, counts: counts({ pending: 2 }) }));
    expect(i.icon).toBe("syncing");
    expect(i.label).toBe("Syncing · 2 waiting");
    expect(i.canSyncNow).toBe(false);
  });

  it("paused for auth asks to sign in and does not offer Sync now", () => {
    const i = describeIndicator(input({ pausedForAuth: true, counts: counts({ pending: 2 }) }));
    expect(i).toMatchObject({ icon: "auth", label: "Sign in again · 2 waiting", needsSignIn: true, canSyncNow: false });
    expect(i.announcement).toMatch(/sign in again/i);
  });

  it("warns when storage is not persistent, but only once the store is ready", () => {
    expect(describeIndicator(input({ persistent: false })).storageWarning).toBe(STORAGE_WARNING);
    expect(describeIndicator(input({ persistent: false, ready: false })).storageWarning).toBeNull();
  });

  it("handles counts that have not loaded yet", () => {
    const i = describeIndicator(input({ counts: null, ready: false }));
    expect(i.waiting).toBe(0);
    expect(i.canSyncNow).toBe(false);
  });
});

const entry = (over: Partial<LocalEntry>): LocalEntry =>
  ({
    key: "2026casj:1",
    teamNumber: 1,
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    superseded: false,
    updatedAt: "2026-11-09T20:00:00.000Z",
    ...over,
  }) as LocalEntry;

describe("selectSheetEntries", () => {
  it("lists unsynced and superseded entries, failed first, then oldest edit", () => {
    const sorted = selectSheetEntries([
      entry({ key: "a", teamNumber: 1, status: "synced" }),
      entry({ key: "b", teamNumber: 2, status: "pending", updatedAt: "2026-11-09T21:00:00.000Z" }),
      entry({ key: "c", teamNumber: 3, status: "failed", updatedAt: "2026-11-09T22:00:00.000Z" }),
      entry({ key: "d", teamNumber: 4, status: "synced", superseded: true }),
      entry({ key: "e", teamNumber: 5, status: "syncing", updatedAt: "2026-11-09T19:00:00.000Z" }),
    ]);
    expect(sorted.map((e) => e.key)).toEqual(["c", "e", "b", "d"]);
  });

  it("does not mutate its input", () => {
    const list = [entry({ key: "x", status: "pending" }), entry({ key: "y", status: "failed" })];
    selectSheetEntries(list);
    expect(list.map((e) => e.key)).toEqual(["x", "y"]);
  });
});

describe("describeEntryRow", () => {
  it("a failed entry the core gave up on retrying: error text, attempts, Retry", () => {
    const row = describeEntryRow(
      entry({ status: "failed", nextAttemptAt: null, attempts: 3, lastError: { kind: "permission", message: "You don't have permission to save this." } }),
    );
    expect(row).toMatchObject({
      statusText: "Sync failed",
      errorText: "You don't have permission to save this.",
      attemptsText: "Tried 3 times",
      canRetry: true,
      tone: "error",
    });
  });

  it("a failed entry that will retry says so and is only a warning", () => {
    const row = describeEntryRow(entry({ status: "failed", nextAttemptAt: 5, attempts: 1 }));
    expect(row).toMatchObject({ statusText: "Not synced yet (will retry)", attemptsText: "Tried 1 time", tone: "warning" });
  });

  it("pending and syncing entries cannot be 'retried' individually", () => {
    expect(describeEntryRow(entry({ status: "pending" }))).toMatchObject({ statusText: "Not synced yet", canRetry: false });
    expect(describeEntryRow(entry({ status: "syncing" }))).toMatchObject({ statusText: "Syncing…", canRetry: false });
  });

  it("a superseded synced entry carries the non-alarming notice", () => {
    const row = describeEntryRow(entry({ status: "synced", superseded: true }));
    expect(row.statusText).toBe("Synced");
    expect(row.supersededNote).toMatch(/newer version from another scout/);
    expect(row.tone).toBe("neutral");
  });
});

describe("time formatting", () => {
  it("returns null for missing values and a string for real ones", () => {
    expect(formatClockTime(null)).toBeNull();
    expect(formatSavedAt(undefined)).toBeNull();
    expect(formatClockTime(Date.UTC(2026, 10, 9, 20, 0))).toEqual(expect.any(String));
  });

  it("cachedDataMessage is null for fresh data (null) and mentions the time otherwise", () => {
    expect(cachedDataMessage(null)).toBeNull();
    expect(cachedDataMessage(undefined)).toBeNull();
    expect(cachedDataMessage(Date.UTC(2026, 10, 9, 20, 0))).toMatch(/^Showing saved data from /);
  });
});

describe("short labels, oldestCachedAt, describeLastOutcome", () => {
  it("short chip text keeps a word and one combined count", () => {
    expect(describeIndicator(input({ connectivity: "offline", counts: counts({ pending: 2, failed: 1 }) })).shortLabel).toBe("Offline · 3");
    expect(describeIndicator(input({ syncing: true, counts: counts({ pending: 2 }) })).shortLabel).toBe("Syncing · 2");
    expect(describeIndicator(input({ pausedForAuth: true })).shortLabel).toBe("Sign in again");
  });

  it("oldestCachedAt picks the stalest time and ignores fresh (null) data", () => {
    expect(oldestCachedAt(null, undefined)).toBeNull();
    expect(oldestCachedAt(500, null, 200, 900)).toBe(200);
  });

  it("describeLastOutcome only speaks up about problems", () => {
    expect(describeLastOutcome(null)).toBeNull();
    expect(describeLastOutcome("completed")).toBeNull();
    expect(describeLastOutcome("aborted")).toBeNull();
    expect(describeLastOutcome("network-error")).toMatch(/safe on this device/);
    expect(describeLastOutcome("paused-auth")).toMatch(/Sign in again/);
    expect(describeLastOutcome("storage-error")).toMatch(/device/);
  });
});
