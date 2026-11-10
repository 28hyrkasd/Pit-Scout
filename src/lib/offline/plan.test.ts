import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  claimEntry,
  computeBackoffMs,
  finishEntry,
  isDue,
  isPhotoDue,
  latestKnownUpdatedAt,
  markLocalChange,
  planNext,
  releaseEntry,
} from "./plan";
import { EVENT, EMPTY_PAYLOAD } from "./test-utils";
import type { LocalEntry, LocalPhoto } from "./types";

const NOW = Date.parse("2026-11-09T20:00:00.000Z");

function entry(overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    schemaVersion: 1,
    key: "2026casj:254",
    id: "id-1",
    eventKey: "2026casj",
    teamNumber: 254,
    payload: EMPTY_PAYLOAD,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    event: EVENT,
    status: "pending",
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    serverId: null,
    serverUpdatedAt: null,
    entryDirty: true,
    superseded: false,
    clockAdjusted: false,
    revision: 1,
    claim: null,
    syncedAt: null,
    ...overrides,
  };
}

function photo(overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    schemaVersion: 1,
    id: "p1",
    eventKey: "2026casj",
    teamNumber: 254,
    entryId: "id-1",
    kind: "upload",
    status: "pending",
    blob: null,
    storagePath: "2026casj/254/p1.jpg",
    attempts: 0,
    lastError: null,
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("computeBackoffMs", () => {
  const policy = { ...DEFAULT_POLICY, jitter: 0 };

  it("doubles from 2s and is capped at 5 minutes", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) =>
      computeBackoffMs(n, () => 0, policy),
    );
    expect(delays).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000,
      300_000,
    ]);
  });

  it("applies jitter downward from the delay, deterministically", () => {
    const p = { ...DEFAULT_POLICY, jitter: 0.5 };
    expect(computeBackoffMs(3, () => 0, p)).toBe(8_000); // no reduction
    expect(computeBackoffMs(3, () => 0.5, p)).toBe(6_000); // 8s * (1 - 0.25)
    expect(computeBackoffMs(3, () => 0.999999, p)).toBe(4_000); // ~half
  });

  it("never exceeds the cap even with a huge failure count", () => {
    expect(computeBackoffMs(10_000, () => 0, policy)).toBe(300_000);
  });
});

describe("isDue", () => {
  it("pending is due once nextAttemptAt has passed", () => {
    expect(isDue(entry({ nextAttemptAt: NOW + 1 }), NOW, "auto")).toBe(false);
    expect(isDue(entry({ nextAttemptAt: NOW }), NOW, "auto")).toBe(true);
  });

  it("synced is never due, even in manual mode", () => {
    expect(isDue(entry({ status: "synced" }), NOW, "manual")).toBe(false);
  });

  it("failed + retryable waits for its schedule; non-retryable (null) never auto-retries", () => {
    const failed = entry({ status: "failed", nextAttemptAt: NOW + 5_000 });
    expect(isDue(failed, NOW, "auto")).toBe(false);
    expect(isDue(failed, NOW + 5_000, "auto")).toBe(true);
    const stuck = entry({ status: "failed", nextAttemptAt: null });
    expect(isDue(stuck, NOW + 10 ** 9, "auto")).toBe(false);
    expect(isDue(stuck, NOW + 10 ** 9, "online")).toBe(false);
  });

  it("manual makes every failed entry due, including non-retryable and out-of-attempts ones", () => {
    expect(
      isDue(entry({ status: "failed", nextAttemptAt: null }), NOW, "manual"),
    ).toBe(true);
    expect(
      isDue(entry({ status: "failed", nextAttemptAt: NOW + 10 ** 9 }), NOW, "manual"),
    ).toBe(true);
  });

  it("'online' retries network failures immediately but not others", () => {
    const net = entry({
      status: "failed",
      nextAttemptAt: NOW + 10 ** 6,
      lastError: { kind: "network", message: "x" },
    });
    const unknown = { ...net, lastError: { kind: "unknown" as const, message: "x" } };
    expect(isDue(net, NOW, "online")).toBe(true);
    expect(isDue(net, NOW, "auto")).toBe(false);
    expect(isDue(unknown, NOW, "online")).toBe(false);
  });

  it("a live syncing claim is not due; a stale one (dead pass) is", () => {
    const syncing = entry({
      status: "syncing",
      claim: { revision: 1, claimedAt: NOW },
    });
    expect(isDue(syncing, NOW + DEFAULT_POLICY.leaseMs, "auto")).toBe(false);
    expect(isDue(syncing, NOW + DEFAULT_POLICY.leaseMs + 1, "auto")).toBe(true);
  });
});

describe("planNext", () => {
  it("picks the entry with the oldest edit first, one at a time", () => {
    const a = entry({ key: "k:a", updatedAt: "2026-11-09T20:00:03.000Z" });
    const b = entry({ key: "k:b", updatedAt: "2026-11-09T20:00:01.000Z" });
    const c = entry({ key: "k:c", updatedAt: "2026-11-09T20:00:02.000Z" });
    expect(planNext([a, b, c], NOW, "auto")?.key).toBe("k:b");
    expect(planNext([a, c], NOW, "auto")?.key).toBe("k:c");
  });

  it("skips entries that are not due and entries the driver already handled", () => {
    const later = entry({ key: "k:a", nextAttemptAt: NOW + 1 });
    const handled = entry({ key: "k:b" });
    expect(planNext([later, handled], NOW, "auto", DEFAULT_POLICY, (e) => e.key === "k:b")).toBeUndefined();
  });
});

describe("markLocalChange", () => {
  it("returns a failed entry to pending, due now, with failure history cleared", () => {
    const next = markLocalChange(
      entry({
        status: "failed",
        attempts: 5,
        nextAttemptAt: null,
        lastError: { kind: "invalid", message: "x" },
      }),
      NOW,
    );
    expect(next).toMatchObject({
      status: "pending",
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
      revision: 2,
    });
  });

  it("keeps a LIVE syncing claim (the in-flight pass owns the record) but bumps the revision", () => {
    const syncing = entry({
      status: "syncing",
      claim: { revision: 1, claimedAt: NOW },
    });
    const next = markLocalChange(syncing, NOW + 1_000);
    expect(next.status).toBe("syncing");
    expect(next.claim).toEqual({ revision: 1, claimedAt: NOW });
    expect(next.revision).toBe(2);
  });

  it("does not stay 'syncing' on a dead claim", () => {
    const dead = entry({
      status: "syncing",
      claim: { revision: 1, claimedAt: NOW },
    });
    expect(markLocalChange(dead, NOW + DEFAULT_POLICY.leaseMs + 1).status).toBe("pending");
  });
});

describe("claimEntry (clock sanity)", () => {
  it("leaves a normal updatedAt alone", () => {
    const e = entry();
    const claimed = claimEntry(e, NOW);
    expect(claimed.updatedAt).toBe(e.updatedAt);
    expect(claimed.clockAdjusted).toBe(false);
    expect(claimed.status).toBe("syncing");
    expect(claimed.claim).toEqual({ revision: 1, claimedAt: NOW });
  });

  it("accepts up to 24h of future skew", () => {
    const future = new Date(NOW + 24 * 3_600_000).toISOString();
    expect(claimEntry(entry({ updatedAt: future }), NOW).updatedAt).toBe(future);
  });

  it("rewrites an updatedAt more than 24h in the future to now (and flags it)", () => {
    const future = new Date(NOW + 24 * 3_600_000 + 1).toISOString();
    const claimed = claimEntry(entry({ updatedAt: future, createdAt: future }), NOW);
    expect(claimed.updatedAt).toBe(new Date(NOW).toISOString());
    expect(claimed.createdAt).toBe(new Date(NOW).toISOString());
    expect(claimed.clockAdjusted).toBe(true);
  });

  it("never goes earlier than the last version the server showed us", () => {
    const serverUpdatedAt = new Date(NOW + 1_000).toISOString();
    const future = new Date(NOW + 48 * 3_600_000).toISOString();
    const claimed = claimEntry(entry({ updatedAt: future, serverUpdatedAt }), NOW);
    expect(new Date(claimed.updatedAt).getTime()).toBe(NOW + 1_001);
  });

  it("never RAISES updatedAt", () => {
    const serverUpdatedAt = new Date(NOW + 72 * 3_600_000).toISOString();
    const future = new Date(NOW + 48 * 3_600_000).toISOString();
    // the server's own time is further out than ours: keep ours
    const claimed = claimEntry(entry({ updatedAt: future, serverUpdatedAt }), NOW);
    expect(claimed.updatedAt).toBe(future);
    expect(claimed.clockAdjusted).toBe(false);
  });
});

describe("releaseEntry", () => {
  it("gives a syncing entry back as pending without touching attempts", () => {
    const released = releaseEntry(
      entry({ status: "syncing", attempts: 3, claim: { revision: 1, claimedAt: NOW } }),
    );
    expect(released).toMatchObject({ status: "pending", attempts: 3, claim: null });
  });
});

describe("finishEntry", () => {
  const rnd = () => 0;
  const policy = { ...DEFAULT_POLICY, jitter: 0 };
  const claimed = (o: Partial<LocalEntry> = {}) =>
    entry({ status: "syncing", entryDirty: false, claim: { revision: 1, claimedAt: NOW }, ...o });
  const input = { baseAttempts: 0, claimRevision: 1, entryFailure: null, photos: [] as LocalPhoto[] };

  it("synced when nothing is owed", () => {
    const { entry: e, prunePhotoIds } = finishEntry(
      claimed(),
      { ...input, photos: [photo({ status: "uploaded" })] },
      NOW,
      rnd,
      policy,
    );
    expect(e).toMatchObject({ status: "synced", attempts: 0, lastError: null, nextAttemptAt: null, syncedAt: NOW });
    expect(prunePhotoIds).toEqual(["p1"]);
  });

  it("failed + retryable: attempts+1 and exponential nextAttemptAt", () => {
    const first = finishEntry(claimed(), { ...input, entryFailure: { kind: "network", message: "x" } }, NOW, rnd, policy).entry;
    expect(first).toMatchObject({ status: "failed", attempts: 1, nextAttemptAt: NOW + 2_000 });
    const third = finishEntry(claimed({ attempts: 2 }), { ...input, baseAttempts: 2, entryFailure: { kind: "unknown", message: "x" } }, NOW, rnd, policy).entry;
    expect(third).toMatchObject({ attempts: 3, nextAttemptAt: NOW + 8_000 });
  });

  it("non-retryable failure: failed with no automatic retry", () => {
    for (const kind of ["permission", "invalid", "quota"] as const) {
      const e = finishEntry(claimed(), { ...input, entryFailure: { kind, message: "x" } }, NOW, rnd, policy).entry;
      expect(e).toMatchObject({ status: "failed", nextAttemptAt: null, lastError: { kind } });
    }
  });

  it("after maxAttempts the entry waits for a manual retry, but is NOT discarded", () => {
    const e = finishEntry(
      claimed({ attempts: 7 }),
      { ...input, baseAttempts: 7, entryFailure: { kind: "unknown", message: "x" } },
      NOW,
      rnd,
      { ...policy, maxAttempts: 8 },
    ).entry;
    expect(e).toMatchObject({ status: "failed", attempts: 8, nextAttemptAt: null });
  });

  it("network failures never run the entry out of attempts", () => {
    const e = finishEntry(
      claimed({ attempts: 50 }),
      { ...input, baseAttempts: 50, entryFailure: { kind: "network", message: "x" } },
      NOW,
      rnd,
      policy,
    ).entry;
    expect(e.nextAttemptAt).toBe(NOW + 300_000);
  });

  it("an outstanding photo keeps the entry failed even with no entry-level failure", () => {
    const e = finishEntry(
      claimed(),
      { ...input, photos: [photo({ status: "failed", lastError: { kind: "unknown", message: "x" } }), photo({ id: "p2", status: "uploaded" })] },
      NOW,
      rnd,
      policy,
    );
    expect(e.entry.status).toBe("failed");
    expect(e.prunePhotoIds).toEqual([]);
  });

  it("prefers a retryable failure over a non-retryable one for scheduling", () => {
    const e = finishEntry(
      claimed(),
      {
        ...input,
        photos: [
          photo({ id: "a", status: "failed", lastError: { kind: "permission", message: "x" } }),
          photo({ id: "b", status: "failed", lastError: { kind: "unknown", message: "y" } }),
        ],
      },
      NOW,
      rnd,
      policy,
    ).entry;
    expect(e.nextAttemptAt).toBe(NOW + 2_000);
    expect(e.lastError?.kind).toBe("unknown");
  });

  it("edited while syncing: pending and due now, never 'synced'", () => {
    const e = finishEntry(
      claimed({ revision: 2, entryDirty: true }),
      { ...input, claimRevision: 1 },
      NOW,
      rnd,
      policy,
    ).entry;
    expect(e).toMatchObject({ status: "pending", nextAttemptAt: NOW, attempts: 0 });
  });

  it("edited while syncing + network failure: pending but still honors the backoff", () => {
    const e = finishEntry(
      claimed({ revision: 2, entryDirty: true }),
      { ...input, claimRevision: 1, entryFailure: { kind: "network", message: "x" } },
      NOW,
      rnd,
      policy,
    ).entry;
    expect(e).toMatchObject({ status: "pending", nextAttemptAt: NOW + 2_000, attempts: 1 });
  });
});

describe("isPhotoDue / latestKnownUpdatedAt", () => {
  it("skips uploaded photos and auto-skips non-retryable failures; manual retries them", () => {
    expect(isPhotoDue(photo({ status: "uploaded" }), "manual")).toBe(false);
    const refused = photo({ status: "failed", lastError: { kind: "permission", message: "x" } });
    expect(isPhotoDue(refused, "auto")).toBe(false);
    expect(isPhotoDue(refused, "manual")).toBe(true);
    expect(isPhotoDue(photo({ status: "failed", lastError: { kind: "network", message: "x" } }), "auto")).toBe(true);
    expect(isPhotoDue(photo({ status: "uploading" }), "auto")).toBe(true);
  });

  it("latestKnownUpdatedAt compares instants and ignores junk", () => {
    expect(
      latestKnownUpdatedAt("2026-11-09T20:00:00.000Z", null, undefined, "nope", "2026-11-09T20:00:01+00:00"),
    ).toBe("2026-11-09T20:00:01+00:00");
    expect(latestKnownUpdatedAt(null)).toBeNull();
  });
});
