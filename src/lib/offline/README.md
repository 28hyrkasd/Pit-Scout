# `src/lib/offline` — offline-first core (Phase 8)

Framework-free (no React, no Next, nothing touches `window` at import time).
Everything is injected (store, network deps, clock, randomness), so all of it is
unit-tested without a browser. Import from `@/lib/offline` (`index.ts`).

```
types.ts         data model (LocalEntry, LocalPhoto, statuses)
schema.ts        zod schemas for what we persist/cache (reads are validated)
errors.ts        StorageUnavailableError, quota detection/normalisation
backend.ts       StorageBackend interface + object-store specs
memory-backend.ts / idb-backend.ts   the two backends (idb one is thin)
store.ts         OfflineStore + BackendStore (ALL logic, tested on memory backend)
local.ts         what the UI calls: saveEntryLocally, addPhotoLocally, ...
plan.ts          PURE state machine: due-ness, backoff, claim/finish transitions
sync.ts          runSyncPass driver (I/O through injected SyncDeps)
supabase-deps.ts real SyncDeps built from the existing helpers
connectivity.ts  ConnectivityMonitor (probe + hysteresis)
cache.ts         cachePut / cacheGet with zod validation
test-utils.ts    FakeServer (models upsert_scouting_entry + FKs), crash injection
```

## Data model (IndexedDB database `pit-scout`, version 1)

| store     | key                         | holds |
|-----------|-----------------------------|-------|
| `entries` | `${eventKey}:${teamNumber}` | one **LocalEntry** per team per event |
| `photos`  | photo uuid (index `byTeam` = `[eventKey, teamNumber]`) | **LocalPhoto**: staged uploads and queued removals |
| `cache`   | caller's string key         | `{ value, savedAt }` |
| `meta`    | `pausedForAuth`, `lastSyncAt` | small flags |

**LocalEntry** (see `types.ts` for every field): `id` (client uuid, stable across
edits), `payload` (answers/rating/notes/scoutedBy), `createdAt`, `updatedAt`
(the last-write-wins clock), `event` (snapshot for the `events` upsert),
`status`, `attempts`, `nextAttemptAt` (ms; `null` on a failed entry = **no
automatic retry**), `lastError {kind,message}`, `serverId` (surviving id after a
sync; may differ from `id`), `serverUpdatedAt`, `entryDirty` (RPC still owed),
`superseded`, `clockAdjusted`, `revision` (bumped by every local change),
`claim {revision, claimedAt}` (only while `syncing`), `syncedAt`.

**LocalPhoto**: `kind` `upload` (has a `blob`; the blob is dropped once uploaded)
or `removal` (a photo already on the server that was removed offline; keeps
`storagePath`), `status` `pending|uploading|uploaded|failed`, `entryId` (current
server-side parent), `attempts`, `lastError`. `storagePath` is deterministic
(`photoStoragePath`).

Every write that touches an entry and/or its photos goes through
`store.transact(team, apply)`: it reads the team's entry + photos, runs `apply`
synchronously, and commits what it returns in ONE transaction. That is what makes
"edit while a sync is in flight", "re-point photos" and "add photo + schedule
entry" race-free, and what keeps a failed (e.g. quota) write from leaving partial data.

## Status transitions

```
  save / add photo / remove photo
  (from ANY state; while `syncing`
   only `revision` moves, see below)
              │
              ▼        claim (oldest edit first)
         ┌─────────┐ ───────────────────────────► ┌─────────┐
  ┌────► │ pending │                              │ syncing │ ──── all done ───► ┌────────┐
  │      └─────────┘ ◄─────────────────────────── └─────────┘                    │ synced │
  │          ▲   ▲      401 (queue paused),          │                           └────────┘
  │          │   │      abort, or edited             │ a step failed                  │
  │          │   │      while syncing                ▼                                │
  │          │   │                              ┌─────────┐                           │
  │          │   └───────────────────────────── │ failed  │                           │
  │          │      retry due (nextAttemptAt),  └─────────┘                           │
  │          │      "Sync now", or any edit                                            │
  └──────────┴─────────────────────────────────────────────────────────────────────────┘
                              (edit / photo change on a synced entry)
```

* `pending → syncing`: a pass claims the entry (`claim` + lease). A claim not
  refreshed for 2 min (dead process/tab) can be taken over.
* `syncing → synced`: entry upsert done (or not owed) AND every photo uploaded + row
  inserted AND every removal done AND no edit happened meanwhile.
* `syncing → failed`: any step failed. Retryable (`network`, `unknown`):
  `nextAttemptAt = now + backoff(attempts)`. Not retryable (`permission`,
  `invalid`, `quota`) or attempts ≥ `maxAttempts` (network errors don't count):
  `nextAttemptAt = null`, i.e. only a manual "Sync now" retries (data is never discarded).
* `syncing → pending` without failure: 401 (queue paused), abort signal, or the
  scout edited while the pass ran (the pass notices `revision` moved).
* Superseded: if the server already had a newer version (`updatedAt` not ours),
  the entry still ends `synced` with `superseded: true`; cleared by the next edit.

Photo records: `pending → uploading → uploaded` (blob dropped; pruned when the
entry is `synced`). Failure → `failed` with `lastError`, retried by later passes
(non-retryable ones only on manual). A staged photo that is removed is simply
deleted; one that is uploading/uploaded becomes a `removal`.

Retry schedule: `delay = min(cap, base · factor^(failures-1)) · (1 − jitter·random())`
with defaults base 2 s, factor 2, cap 5 min, jitter 0.5, `maxAttempts` 8.

## Sync pass, step by step, and why each step is idempotent

`runSyncPass(store, deps, { now, random, signal, mode, policy })`, single-flight per store.

1. **claim** (local transaction) — due-check is repeated inside the transaction.
   Re-running just re-claims.
2. **ensure `events` row** — upsert on primary key (`onConflict: key`). Once per event per pass.
3. **`upsert_scouting_entry`** — id = `serverId ?? id`. Same id + same `updatedAt`
   is a no-op in SQL (`existing.updated_at < p_updated_at` is false) and returns the stored row.
4. **record result** (one local transaction): `serverId`, `serverUpdatedAt`,
   `superseded = !wasApplied(...)`, `entryDirty = (edited meanwhile)`, and **every photo
   and removal of the team is re-pointed to the surviving id**. A crash before this
   just repeats step 3 (no-op).
5. **per photo**: mark `uploading` → upload object (`upsert:false`; "already exists" =
   success) → insert `entry_photos` row (23505 duplicate = success) → mark `uploaded`.
   The row is inserted only after the object exists. A crash anywhere repeats the
   same calls, each of which treats "already done" as success; `uploaded` photos are skipped.
6. **per removal**: delete row, then object (row first: a failed object delete leaves
   an unreferenced file, never a row pointing at nothing), then drop the local record.
   Deleting a missing row/object is not an error. Object-delete failures other than
   network/401 are ignored (harmless leftover).
7. **finish** (local transaction): `synced` / `failed` / `pending` (see above).

Pass-level rules: entries are handled oldest edit first, one at a time. A network error
ends the pass (remaining entries untouched, attempts not incremented). 401 sets
`meta.pausedForAuth`, hands the in-flight entry back as `pending` untouched, and
returns `{ outcome: "paused-auth" }`; later passes (even manual) return the same
immediately until `resumeAfterAuth()`. Per-photo failures never fail the entry
itself; they leave it `failed` (retryable) with only the missing photos retried.

Tested by crashing after EVERY server call and EVERY local commit of five scenarios
(`sync-crash.test.ts`) and requiring a fresh pass to converge to exactly the
uninterrupted result.

## Public API for the UI

```ts
import {
  openOfflineStoreWithFallback, createSupabaseSyncDeps, runSyncPass, resumeAfterAuth,
  saveEntryLocally, addPhotoLocally, removePhotoLocally, getLocalEntry, listLocalEntries,
  listPending, getSyncCounts, clearSyncedEntries, resetOfflineData,
  ConnectivityMonitor, cacheGet, cachePut, cacheKeys, cacheSchemas,
} from "@/lib/offline";
```

Setup (client only, once; e.g. in a provider's effect):

```ts
const { store, persistent, reason } = await openOfflineStoreWithFallback();
// persistent === false: IndexedDB unavailable (Safari private mode...). Show
// "Offline saving isn't available in this browser"; nothing survives a reload.
const deps = createSupabaseSyncDeps(createClient());
const monitor = new ConnectivityMonitor({
  fetch: (u, i) => fetch(u, i), windowTarget: window, documentTarget: document,
}); // probeUrl defaults to /api/health
monitor.start(); // stop() on cleanup. useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getServerSnapshot)
```

Triggers (all safe to fire together, single-flight): after each local save; on
monitor status → `"online"` with `{ mode: "online" }`; on window focus / every ~30 s
with `{ mode: "auto" }`; the "Sync now" button with `{ mode: "manual" }`. After sign-in:
`await resumeAfterAuth(store)` then run a pass. Wrap passes in
`navigator.locks.request("pit-scout-sync", { ifAvailable: true }, ...)` if more than one
tab can be open (the lease already prevents corruption; the lock avoids duplicate work).

Saving (replaces the online save when offline or when the network fails):

```ts
const entry = await saveEntryLocally(store, { event, teamNumber, payload, base /* SavedEntry | null */ });
for (const blob of staged) await addPhotoLocally(store, { event, teamNumber, blob, base });
void runSyncPass(store, deps);
await removePhotoLocally(store, { event, teamNumber, photoId, serverPhoto /* PhotoRecord if on server */, base });
```

All of these reject with `SaveError` kind `"quota"` (device full; nothing was changed) or
`StorageUnavailableError`. Pass `base` (the server's `SavedEntry`) when the scout
started from a server version and no local record exists yet.

Reading for UI: `getLocalEntry`, `listLocalEntries(eventKey)`, `listPending`,
`getSyncCounts` (`unsynced`, `needsManualRetry`, `superseded`, photo counts),
`isPausedForAuth`, `isSyncRunning`, `store.getMeta("lastSyncAt")`. Show a "your version was
not applied (newer one exists)" notice for `entry.superseded`.

Cache: `cachePut(store, cacheKeys.teams(eventKey), teams)`;
`cacheGet(store, cacheKeys.teams(eventKey), cacheSchemas.teams, { maxAgeMs })` →
`{ value, savedAt, stale } | null`. Corrupt/old entries are discarded; writes never throw.

Sign-out must NOT call `resetOfflineData` without confirming (it drops unsynced scouting
data); warn when `getSyncCounts().unsynced > 0`.

## Decisions

* **Clock**: on claim, an `updatedAt` more than 24 h ahead of this device's clock is
  rewritten to `nextUpdatedAt(now, serverUpdatedAt)` (only ever lowered), flagged `clockAdjusted`.
  Edits themselves never go earlier than anything seen for the team.
* **Probe**: `HEAD /api/health` → 204, `Cache-Control: no-store`, public, never cached by the SW.
* **maxAttempts** 8 (~8 min of backoff); network failures never count toward it.
* A "Sync now" that arrives during a running pass joins it (same promise); call again once it settles.

## Changes the integration step needs in existing files

1. **Add `src/app/api/health/route.ts`**: `HEAD` (and `GET`) → `new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })`.
2. **`src/proxy.ts` matcher**: exclude `api/health` so the probe isn't redirected to `/login`.
3. **Service worker (Serwist)**: `NetworkOnly` for `/api/health` and all `/api/*`; never precache them; do not
   let a cached app shell answer it.
4. **Save flow** (`src/components/entries/*`): route saves through `saveEntryLocally`/`addPhotoLocally`/`removePhotoLocally`
   then trigger a pass (the old online-only save path has been removed; saving always goes through the local store first).
5. **Query cache** (`src/lib/api/queries.ts`): persist fields/teams/EPA with `cachePut`/`cacheGet` as the offline fallback.
6. Optionally refactor `saveEventToDatabase` (`src/lib/api/save-event.ts`) to call `upsertEventRow` (duplicate column mapping).

## Not verified

No real IndexedDB (no `fake-indexeddb` in node_modules): the `idb` backend is tested against a hand-written
fake of the idb API, so browser transaction/quota/blocked semantics are unverified. No real Supabase, no phone.
