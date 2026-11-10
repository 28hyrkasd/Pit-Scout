/**
 * Shared test doubles for src/lib/offline. Not exported from index.ts and not
 * imported by app code.
 *
 * FakeServer reproduces the parts of Supabase the sync depends on, INCLUDING the
 * semantics of upsert_scouting_entry (last-write-wins by updated_at keyed on
 * event+team, surviving id may differ) and the foreign keys (events <- entries
 * <- photos), so a driver bug like "photo still points at the dropped id" fails
 * here the way it would fail against Postgres.
 */
import type { SavedEntry, UpsertEntryInput } from "@/lib/entries/rpc";
import type { AppEvent } from "@/lib/external/schemas";
import { StorageUnavailableError } from "./errors";
import { createMemoryStore } from "./memory-backend";
import { saveEntryLocally, addPhotoLocally } from "./local";
import type { OfflineStore } from "./store";
import type { SyncDeps } from "./sync";
import type { LocalEntry } from "./types";

export const EVENT: AppEvent = {
  key: "2026casj",
  name: "Silicon Valley Regional",
  year: 2026,
  startDate: "2026-03-01",
  endDate: "2026-03-04",
  city: "San Jose",
  stateProv: "CA",
  country: "USA",
};

export const EMPTY_PAYLOAD = {
  answers: {},
  rating: null,
  notes: null,
  scoutedBy: null,
};

/** Valid v4-shaped UUIDs: 00000000-0000-4000-8000-000000000001, ... */
export function uuidSequence(prefix = 0) {
  let n = 0;
  return () => {
    n += 1;
    return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

export function fakeClock(start = Date.parse("2026-11-09T20:00:00.000Z")) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

// --- errors the real dependencies would throw (raw, before classification) ---
export const networkError = () => new TypeError("Failed to fetch");
export const authError = () => ({ status: 401, message: "JWT expired" });
export const permissionError = () => ({ code: "42501", message: "denied" });
export const invalidError = () => ({ code: "23514", message: "check" });
export const serverQuotaError = () => ({ message: "Storage quota exceeded" });
export const unknownError = () => new Error("boom");

export class CrashError extends StorageUnavailableError {
  constructor() {
    super("process killed");
    this.name = "CrashError";
  }
}

/** Simulates the process dying: after the Nth side effect, every later effect and store write throws. */
export class CrashController {
  steps = 0;
  crashed = false;
  constructor(private crashAfter: number | null = null) {}
  guard() {
    if (this.crashed) throw new CrashError();
  }
  /** Call after an effect took place. */
  afterStep() {
    this.steps += 1;
    if (this.crashAfter !== null && this.steps >= this.crashAfter) {
      this.crashed = true;
      throw new CrashError();
    }
  }
  /** "Reboot": the next process starts clean. */
  reboot() {
    this.crashed = false;
    this.crashAfter = null;
  }
}

export function crashingStore(
  store: OfflineStore,
  crash: CrashController,
): OfflineStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const writes = new Set(["transact", "setMeta"]);
      return async (...args: unknown[]) => {
        crash.guard();
        const result = await (value as (...a: unknown[]) => unknown).apply(
          target,
          args,
        );
        if (typeof prop === "string" && writes.has(prop)) crash.afterStep();
        return result;
      };
    },
  });
}

type Op = keyof SyncDeps;
type Fault = {
  op: Op;
  error: unknown;
  times: number;
  when?: (arg: unknown) => boolean;
};

type ServerEntry = {
  id: string;
  eventKey: string;
  teamNumber: number;
  payload: UpsertEntryInput["payload"];
  createdAt: string;
  updatedAtMs: number;
};

const pg = (ms: number) => new Date(ms).toISOString().replace("Z", "+00:00");

export class FakeServer {
  events = new Map<string, AppEvent>();
  entries = new Map<string, ServerEntry>();
  photoRows = new Map<string, { id: string; entryId: string; storagePath: string }>();
  objects = new Map<string, Blob>();
  /** Every effect that reached the server, in order, e.g. "upsert:2026casj:254". */
  log: string[] = [];
  private faults: Fault[] = [];
  crash: CrashController | null = null;
  /** Called at the start of every dependency call (lets a test act "while the request is in flight"). */
  onCall: ((op: Op) => void | Promise<void>) | null = null;

  failNext(
    op: Op,
    error: unknown,
    options: { times?: number; when?: (arg: unknown) => boolean } = {},
  ) {
    this.faults.push({ op, error, times: options.times ?? 1, when: options.when });
  }
  clearFaults() {
    this.faults = [];
  }

  count(prefix: string) {
    return this.log.filter((l) => l.startsWith(prefix)).length;
  }

  private async enter(op: Op, arg: unknown) {
    this.crash?.guard();
    await this.onCall?.(op);
    const fault = this.faults.find(
      (f) => f.op === op && f.times > 0 && (!f.when || f.when(arg)),
    );
    if (fault) {
      fault.times -= 1;
      throw fault.error;
    }
  }

  private done() {
    this.crash?.afterStep();
  }

  deps(): SyncDeps {
    return {
      ensureEvent: async (event) => {
        await this.enter("ensureEvent", event);
        this.events.set(event.key, event);
        this.log.push(`event:${event.key}`);
        this.done();
      },
      upsertEntry: async (input) => {
        await this.enter("upsertEntry", input);
        if (!this.events.has(input.eventKey))
          throw { code: "23503", message: "fk events" };
        this.log.push(`upsert:${input.eventKey}:${input.teamNumber}:${input.id}`);
        const saved = this.upsert(input);
        this.done();
        return saved;
      },
      uploadPhoto: async (storagePath, blob) => {
        await this.enter("uploadPhoto", storagePath);
        this.log.push(`upload:${storagePath}`);
        // upsert:false + "already exists" is success, like uploadPhotoObject.
        if (!this.objects.has(storagePath)) this.objects.set(storagePath, blob);
        this.done();
      },
      insertPhotoRow: async (row) => {
        await this.enter("insertPhotoRow", row);
        const parent = [...this.entries.values()].find((e) => e.id === row.entryId);
        if (!parent) throw { code: "23503", message: "fk entries" };
        this.log.push(`row:${row.id}->${row.entryId}`);
        if (!this.photoRows.has(row.id)) this.photoRows.set(row.id, row); // dup = success
        this.done();
      },
      deletePhotoRow: async (id) => {
        await this.enter("deletePhotoRow", id);
        this.log.push(`delrow:${id}`);
        this.photoRows.delete(id);
        this.done();
      },
      deletePhotoObject: async (storagePath) => {
        await this.enter("deletePhotoObject", storagePath);
        this.log.push(`delobj:${storagePath}`);
        this.objects.delete(storagePath);
        this.done();
      },
    };
  }

  /** upsert_scouting_entry, transcribed from supabase/migrations/..._init_schema.sql. */
  private upsert(input: UpsertEntryInput): SavedEntry {
    const key = `${input.eventKey}:${input.teamNumber}`;
    const sent = new Date(input.updatedAt).getTime();
    const existing = this.entries.get(key);
    const write = (row: ServerEntry) => {
      this.entries.set(key, row);
      return this.toSaved(row);
    };
    if (!existing)
      return write({
        id: input.id,
        eventKey: input.eventKey,
        teamNumber: input.teamNumber,
        payload: input.payload,
        createdAt: input.createdAt,
        updatedAtMs: sent,
      });
    if (existing.id === input.id) {
      return existing.updatedAtMs < sent
        ? write({ ...existing, payload: input.payload, updatedAtMs: sent })
        : this.toSaved(existing);
    }
    // different client UUID, same event+team
    if (existing.updatedAtMs >= sent) return this.toSaved(existing);
    return write({ ...existing, payload: input.payload, updatedAtMs: sent });
  }

  private toSaved(row: ServerEntry): SavedEntry {
    return {
      id: row.id,
      eventKey: row.eventKey,
      teamNumber: row.teamNumber,
      answers: row.payload.answers,
      rating: row.payload.rating,
      notes: row.payload.notes,
      scoutedBy: row.payload.scoutedBy,
      createdAt: row.createdAt,
      updatedAt: pg(row.updatedAtMs),
    };
  }

  /** The one server entry for a team. */
  entryFor(eventKey: string, teamNumber: number) {
    return this.entries.get(`${eventKey}:${teamNumber}`);
  }

  /** A compact, comparable picture of everything on the server. */
  snapshot() {
    return {
      events: [...this.events.keys()].sort(),
      entries: [...this.entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, e]) => ({ k, id: e.id, updatedAtMs: e.updatedAtMs, payload: e.payload })),
      photoRows: [...this.photoRows.values()].sort((a, b) => a.id.localeCompare(b.id)),
      objects: [...this.objects.keys()].sort(),
    };
  }
}

/** A fresh store + clock + server + id source. */
export function makeEnv(options: { idPrefix?: number; start?: number } = {}) {
  const store = createMemoryStore();
  const clock = fakeClock(options.start);
  const server = new FakeServer();
  const makeId = uuidSequence(options.idPrefix ?? 1);
  return { store, clock, server, makeId, ops: { now: clock.now, makeId } };
}
export type Env = ReturnType<typeof makeEnv>;

export const jpeg = (label = "x") => new Blob([label], { type: "image/jpeg" });

/** Queue an entry (and N photos) the way the UI would while offline. */
export async function queueEntry(
  env: Pick<Env, "store" | "ops">,
  teamNumber: number,
  options: { photos?: number; answers?: Record<string, string | number | boolean | null> } = {},
): Promise<LocalEntry> {
  const entry = await saveEntryLocally(
    env.store,
    {
      event: EVENT,
      teamNumber,
      payload: { ...EMPTY_PAYLOAD, answers: options.answers ?? {} },
    },
    env.ops,
  );
  for (let i = 0; i < (options.photos ?? 0); i++)
    await addPhotoLocally(
      env.store,
      { event: EVENT, teamNumber, blob: jpeg(`p${i}`) },
      env.ops,
    );
  return (await env.store.getEntry(entry.key)) as LocalEntry;
}

/** Deterministic jitter: 0 = shortest delay allowed by the policy's jitter. */
export const noJitter = () => 0;
