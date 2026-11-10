import { describe, expect, it } from "vitest";
import type { SavedEntry } from "@/lib/entries/rpc";
import type { LocalEntry } from "@/lib/offline/types";
import { SUPERSEDED_NOTICE, localToSaved, mergeEntry, mergeEventEntries, serverEntryIdFor, syncBadge } from "./merge-entries";

const server = (over: Partial<SavedEntry> = {}): SavedEntry => ({
  id: "server-id",
  eventKey: "2026casj",
  teamNumber: 254,
  answers: { f: "server" },
  rating: 3,
  notes: "server notes",
  scoutedBy: "Dana",
  createdAt: "2026-11-09T18:00:00.000Z",
  // Postgres style offset, not "Z": instants must be compared, not strings.
  updatedAt: "2026-11-09T19:00:00+00:00",
  ...over,
});

const local = (over: Partial<LocalEntry> = {}): LocalEntry => ({
  schemaVersion: 1,
  key: "2026casj:254",
  id: "local-id",
  eventKey: "2026casj",
  teamNumber: 254,
  payload: { answers: { f: "local" }, rating: 5, notes: "local notes", scoutedBy: "Sam" },
  createdAt: "2026-11-09T20:00:00.000Z",
  updatedAt: "2026-11-09T20:00:00.000Z",
  event: {
    key: "2026casj",
    name: "x",
    year: 2026,
    startDate: null,
    endDate: null,
    city: null,
    stateProv: null,
    country: null,
  },
  status: "pending",
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  serverId: null,
  serverUpdatedAt: null,
  entryDirty: true,
  superseded: false,
  clockAdjusted: false,
  revision: 1,
  claim: null,
  syncedAt: null,
  ...over,
});

describe("syncBadge", () => {
  it("has text for every unsynced state and none for synced", () => {
    expect(syncBadge({ status: "synced", nextAttemptAt: null })).toBeNull();
    expect(syncBadge({ status: "pending", nextAttemptAt: 0 })).toEqual({ kind: "pending", text: "Not synced yet" });
    expect(syncBadge({ status: "syncing", nextAttemptAt: 0 })).toEqual({ kind: "syncing", text: "Syncing…" });
  });
  it("a failed entry the core will retry reads as 'Not synced yet'; one it will not retry reads 'Sync failed'", () => {
    expect(syncBadge({ status: "failed", nextAttemptAt: 123 })?.text).toBe("Not synced yet");
    expect(syncBadge({ status: "failed", nextAttemptAt: null })).toEqual({ kind: "failed", text: "Sync failed" });
  });
});

describe("localToSaved", () => {
  it("uses the server id when known (photos hang off it), else the local id", () => {
    expect(localToSaved(local()).id).toBe("local-id");
    expect(localToSaved(local({ serverId: "srv" })).id).toBe("srv");
  });
  it("carries the payload and timestamps", () => {
    expect(localToSaved(local())).toMatchObject({ answers: { f: "local" }, rating: 5, notes: "local notes", scoutedBy: "Sam" });
  });
});

describe("mergeEntry", () => {
  it("returns null when there is nothing anywhere", () => {
    expect(mergeEntry(null, undefined)).toBeNull();
  });

  it("no local record: the server entry, no badge", () => {
    const m = mergeEntry(server(), undefined);
    expect(m).toMatchObject({ source: "server", badge: null, superseded: false, local: null });
    expect(m?.entry.notes).toBe("server notes");
  });

  it("works with NO server data at all (offline, nothing cached): the local entry is shown with a badge", () => {
    const m = mergeEntry(null, local());
    expect(m?.source).toBe("local");
    expect(m?.entry.notes).toBe("local notes");
    expect(m?.badge?.text).toBe("Not synced yet");
  });

  it("unsynced local newer than the server wins, even across ISO formats", () => {
    const m = mergeEntry(server({ updatedAt: "2026-11-09T19:59:59.999+00:00" }), local());
    expect(m?.source).toBe("local");
    expect(m?.entry.notes).toBe("local notes");
  });

  it("unsynced local OLDER than the server loses (another scout saved later) but keeps its badge", () => {
    const m = mergeEntry(server({ updatedAt: "2026-11-09T21:00:00+00:00" }), local());
    expect(m?.source).toBe("server");
    expect(m?.entry.notes).toBe("server notes");
    expect(m?.badge?.kind).toBe("pending");
  });

  it("a tie goes to the local (the scout's own latest action) when unsynced", () => {
    const m = mergeEntry(server({ updatedAt: "2026-11-09T20:00:00+00:00" }), local());
    expect(m?.source).toBe("local");
  });

  it("an unsynced local entry reuses the server entry's id for its photos once the server id is known", () => {
    const m = mergeEntry(server(), local({ serverId: "server-id" }));
    expect(m?.entry.id).toBe("server-id");
  });

  it("syncing and failed entries get their own badges", () => {
    expect(mergeEntry(null, local({ status: "syncing" }))?.badge?.kind).toBe("syncing");
    expect(mergeEntry(null, local({ status: "failed", nextAttemptAt: null }))?.badge?.text).toBe("Sync failed");
  });

  describe("synced local", () => {
    const synced = (over: Partial<LocalEntry> = {}) => local({ status: "synced", entryDirty: false, ...over });

    it("dedupes: the server copy (same instant) wins and there is no badge", () => {
      const m = mergeEntry(server({ updatedAt: "2026-11-09T20:00:00+00:00" }), synced());
      expect(m).toMatchObject({ source: "server", badge: null, superseded: false });
      expect(m?.entry.id).toBe("server-id");
    });

    it("the local copy is shown until the server list catches up (local strictly newer)", () => {
      const m = mergeEntry(server(), synced());
      expect(m?.source).toBe("local");
      expect(m?.badge).toBeNull();
    });

    it("with no server data (offline) the synced local copy is shown, no badge", () => {
      const m = mergeEntry(null, synced());
      expect(m).toMatchObject({ source: "local", badge: null });
    });

    it("superseded: shows the server's version and flags it", () => {
      const m = mergeEntry(server({ updatedAt: "2026-11-09T21:00:00+00:00" }), synced({ superseded: true }));
      expect(m).toMatchObject({ source: "server", superseded: true, badge: null });
    });

    it("superseded even when the local timestamp looks newer (clock skew): server still wins", () => {
      const m = mergeEntry(server(), synced({ superseded: true }));
      expect(m).toMatchObject({ source: "server", superseded: true });
      // The entry itself (not just the label) is the server's: that is what the form must show.
      expect(m?.entry.answers).toEqual({ f: "server" });
    });

    it("superseded but no server data: falls back to the local copy, still flagged", () => {
      const m = mergeEntry(null, synced({ superseded: true }));
      expect(m).toMatchObject({ source: "local", superseded: true });
    });
  });

  it("SUPERSEDED_NOTICE does not claim the scout's version was kept or applied", () => {
    expect(SUPERSEDED_NOTICE).toMatch(/newer version/i);
    expect(SUPERSEDED_NOTICE).toMatch(/not applied/i);
  });
});

describe("mergeEventEntries", () => {
  it("includes teams only the server knows, only the device knows, and both, sorted by team", () => {
    const merged = mergeEventEntries(
      [server({ teamNumber: 1678, id: "a" }), server({ teamNumber: 254, id: "b" })],
      [local({ teamNumber: 254, key: "2026casj:254" }), local({ teamNumber: 971, key: "2026casj:971" })],
      "2026casj",
    );
    expect(merged.map((m) => m.entry.teamNumber)).toEqual([254, 971, 1678]);
    expect(merged.find((m) => m.entry.teamNumber === 254)?.source).toBe("local");
    expect(merged.find((m) => m.entry.teamNumber === 971)?.badge).not.toBeNull();
    expect(merged.find((m) => m.entry.teamNumber === 1678)?.badge).toBeNull();
  });

  it("with the server list missing entirely (offline, no cache) returns the device's entries", () => {
    const merged = mergeEventEntries(undefined, [local()], "2026casj");
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("local");
  });

  it("with neither it is empty", () => {
    expect(mergeEventEntries(null, null, "2026casj")).toEqual([]);
  });

  it("ignores other events' rows", () => {
    const merged = mergeEventEntries(
      [server({ eventKey: "2026cala" })],
      [local({ eventKey: "2026cala", key: "2026cala:254" })],
      "2026casj",
    );
    expect(merged).toEqual([]);
  });

  it("keeps the newest of two server rows for a team (defensive)", () => {
    const merged = mergeEventEntries(
      [server({ id: "old", updatedAt: "2026-11-09T10:00:00+00:00" }), server({ id: "new", updatedAt: "2026-11-09T11:00:00+00:00" })],
      [],
      "2026casj",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].entry.id).toBe("new");
  });
});

describe("serverEntryIdFor", () => {
  it("is the server row's id when the server's version is shown, or the id the server reported after a sync", () => {
    expect(serverEntryIdFor(mergeEntry(server(), undefined))).toBe("server-id");
    expect(serverEntryIdFor(mergeEntry(null, local({ serverId: "srv" })))).toBe("srv");
  });
  it("is null for an entry the server has never seen, so nothing is asked of it", () => {
    expect(serverEntryIdFor(mergeEntry(null, local()))).toBeNull();
    expect(serverEntryIdFor(null)).toBeNull();
  });
});
