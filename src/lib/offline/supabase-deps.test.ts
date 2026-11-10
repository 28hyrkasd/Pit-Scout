import { describe, expect, it, vi } from "vitest";
import { SaveError } from "@/lib/entries/save-error";
import { createSupabaseSyncDeps, upsertEventRow } from "./supabase-deps";
import { runSyncPass } from "./sync";
import { EVENT, makeEnv, queueEntry } from "./test-utils";

type Result = { error: unknown; status?: number; data?: unknown };

/** A just-enough fake of the supabase-js client for the calls the sync makes. */
function fakeClient(results: { events?: Result; rpc?: Result; insert?: Result; upload?: Result } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const client = {
    from: (table: string) => ({
      upsert: (...args: unknown[]) => (calls.push({ op: `${table}.upsert`, args }), Promise.resolve(results.events ?? { error: null })),
      insert: (...args: unknown[]) => (calls.push({ op: `${table}.insert`, args }), Promise.resolve(results.insert ?? { error: null })),
      delete: () => ({ eq: (...args: unknown[]) => (calls.push({ op: `${table}.delete`, args }), Promise.resolve({ error: null })) }),
    }),
    rpc: (...args: unknown[]) => (calls.push({ op: "rpc", args }), Promise.resolve(results.rpc ?? { data: null, error: null })),
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => (calls.push({ op: "storage.upload", args }), Promise.resolve(results.upload ?? { error: null })),
        remove: (...args: unknown[]) => (calls.push({ op: "storage.remove", args }), Promise.resolve({ error: null })),
      }),
    },
  };
  return { client: client as never, calls };
}

describe("upsertEventRow", () => {
  it("upserts the full events row on the key", async () => {
    const { client, calls } = fakeClient();
    await upsertEventRow(client, EVENT);
    expect(calls).toEqual([
      {
        op: "events.upsert",
        args: [
          {
            key: "2026casj",
            name: "Silicon Valley Regional",
            year: 2026,
            start_date: "2026-03-01",
            end_date: "2026-03-04",
            city: "San Jose",
            state_prov: "CA",
            country: "USA",
          },
          { onConflict: "key" },
        ],
      },
    ]);
  });

  it("throws a CLASSIFIED error (the sync needs to see 401 vs network vs permission)", async () => {
    const unauthorized = await upsertEventRow(fakeClient({ events: { error: { message: "JWT expired" }, status: 401 } }).client, EVENT).catch((e: unknown) => e);
    expect((unauthorized as SaveError).kind).toBe("unauthorized");
    const denied = await upsertEventRow(fakeClient({ events: { error: { code: "42501" } } }).client, EVENT).catch((e: unknown) => e);
    expect((denied as SaveError).kind).toBe("permission");
  });
});

describe("createSupabaseSyncDeps", () => {
  it("routes each dependency to the existing helper (idempotency handled there)", async () => {
    const { client, calls } = fakeClient({
      rpc: {
        data: {
          id: "11111111-0000-4000-8000-000000000001",
          event_key: "2026casj",
          team_number: 254,
          answers: {},
          rating: null,
          notes: null,
          scouted_by: null,
          created_at: "2026-11-09T20:00:00+00:00",
          updated_at: "2026-11-09T20:00:00+00:00",
        },
        error: null,
      },
      // already-exists on upload and unique violation on the row insert are SUCCESS
      upload: { error: { statusCode: "409", message: "The resource already exists" } },
      insert: { error: { code: "23505" } },
    });
    const deps = createSupabaseSyncDeps(client);
    const saved = await deps.upsertEntry({
      id: "11111111-0000-4000-8000-000000000001",
      eventKey: "2026casj",
      teamNumber: 254,
      payload: { answers: {}, rating: null, notes: null, scoutedBy: null },
      createdAt: "2026-11-09T20:00:00.000Z",
      updatedAt: "2026-11-09T20:00:00.000Z",
    });
    expect(saved.id).toBe("11111111-0000-4000-8000-000000000001");
    await expect(deps.uploadPhoto("2026casj/254/x.jpg", new Blob(["x"]))).resolves.toBeUndefined();
    await expect(deps.insertPhotoRow({ id: "p", entryId: "e", storagePath: "x" })).resolves.toBeUndefined();
    await deps.deletePhotoRow("p");
    await deps.deletePhotoObject("2026casj/254/x.jpg");
    expect(calls.map((c) => c.op)).toEqual(["rpc", "storage.upload", "entry_photos.insert", "entry_photos.delete", "storage.remove"]);
  });

  it("end to end: an expired session on the events row pauses the real-deps queue without losing data", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    const { client } = fakeClient({ events: { error: { message: "JWT expired" }, status: 401 } });
    const rpc = vi.spyOn(client as { rpc: () => unknown }, "rpc");
    const result = await runSyncPass(env.store, createSupabaseSyncDeps(client), { now: env.clock.now });
    expect(result.outcome).toBe("paused-auth");
    expect(rpc).not.toHaveBeenCalled();
    expect(await env.store.listPhotos()).toHaveLength(1);
    expect((await env.store.getEntry("2026casj:254"))?.status).toBe("pending");
  });
});
