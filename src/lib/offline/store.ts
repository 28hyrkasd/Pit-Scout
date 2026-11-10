import type { StorageBackend } from "./backend";
import { normalizeStorageError } from "./errors";
import {
  cacheRecordSchema,
  localEntrySchema,
  localPhotoSchema,
  metaSchemas,
  type MetaKey,
  type MetaShape,
} from "./schema";
import {
  entryKey,
  type CacheRecord,
  type LocalEntry,
  type LocalPhoto,
  type TeamRef,
} from "./types";

/** Everything stored for one (event, team): its entry (if any) and all its photo records. Copies: mutate freely. */
export type TeamView = { entry: LocalEntry | undefined; photos: LocalPhoto[] };

/**
 * What a transaction wants written. `entry: null` deletes the entry. Photos are
 * put/deleted by id. Everything in one write is atomic: all or nothing.
 */
export type TeamWrite = {
  entry?: LocalEntry | null;
  putPhotos?: LocalPhoto[];
  deletePhotoIds?: string[];
};

/**
 * The persistence interface used by every other module in src/lib/offline.
 * Implementations: BackendStore over IndexedDB (openOfflineStore) or in memory (tests).
 *
 * Failure contract for every method: rejects with SaveError("quota") when the
 * device is full, StorageUnavailableError when IndexedDB cannot be used, or
 * SaveError("unknown"). A rejected write changes NOTHING.
 */
export interface OfflineStore {
  getEntry(key: string): Promise<LocalEntry | undefined>;
  listEntries(): Promise<LocalEntry[]>;
  getPhoto(id: string): Promise<LocalPhoto | undefined>;
  listPhotos(team?: TeamRef): Promise<LocalPhoto[]>;

  /**
   * The ONLY way entries and photos are written. Reads the team's current entry
   * and photos, calls `apply` (synchronously, so nothing can interleave), and
   * commits what it returns in one atomic transaction. Return `write: null` to
   * change nothing. This is what makes read-modify-write (edit vs. in-flight
   * sync, re-pointing photos) race-free.
   */
  transact<R>(
    team: TeamRef,
    apply: (view: TeamView) => { write: TeamWrite | null; result: R },
  ): Promise<R>;

  getCacheRecord(key: string): Promise<CacheRecord | undefined>;
  putCacheRecord(key: string, record: CacheRecord): Promise<void>;
  deleteCacheRecord(key: string): Promise<void>;
  listCacheKeys(): Promise<string[]>;
  clearCache(): Promise<void>;

  getMeta<K extends MetaKey>(key: K): Promise<MetaShape[K] | undefined>;
  setMeta<K extends MetaKey>(key: K, value: MetaShape[K]): Promise<void>;

  /** Wipes entries, photos, cache and meta. Only call after explicit user confirmation. */
  clearAll(): Promise<void>;
  clearEntriesAndPhotos(): Promise<void>;
  close(): void;
}

/** Wraps an error thrown by caller-supplied code inside a transaction so it is not mistaken for a storage failure. */
class CallerError {
  constructor(readonly error: unknown) {}
}

export type BackendStoreOptions = {
  /** Called for a stored record that failed validation. It is skipped, not deleted. */
  onCorrupt?: (store: "entries" | "photos", key: unknown) => void;
};

export class BackendStore implements OfflineStore {
  constructor(
    private readonly backend: StorageBackend,
    private readonly options: BackendStoreOptions = {},
  ) {}

  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof CallerError) throw error.error;
      throw normalizeStorageError(error);
    }
  }

  private parseEntry(raw: unknown): LocalEntry | undefined {
    if (raw === undefined) return undefined;
    if (localEntrySchema.safeParse(raw).success) return raw as LocalEntry;
    this.options.onCorrupt?.("entries", (raw as { key?: unknown })?.key);
    return undefined;
  }

  private parsePhoto(raw: unknown): LocalPhoto | undefined {
    if (raw === undefined) return undefined;
    if (localPhotoSchema.safeParse(raw).success) return raw as LocalPhoto;
    this.options.onCorrupt?.("photos", (raw as { id?: unknown })?.id);
    return undefined;
  }

  getEntry(key: string) {
    return this.run(async () =>
      this.parseEntry(
        await this.backend.tx(["entries"], "readonly", (tx) =>
          tx.get("entries", key),
        ),
      ),
    );
  }

  listEntries() {
    return this.run(async () => {
      const raw = await this.backend.tx(["entries"], "readonly", (tx) =>
        tx.getAll("entries"),
      );
      return raw.flatMap((r) => this.parseEntry(r) ?? []);
    });
  }

  getPhoto(id: string) {
    return this.run(async () =>
      this.parsePhoto(
        await this.backend.tx(["photos"], "readonly", (tx) =>
          tx.get("photos", id),
        ),
      ),
    );
  }

  listPhotos(team?: TeamRef) {
    return this.run(async () => {
      const raw = await this.backend.tx(["photos"], "readonly", (tx) =>
        team
          ? tx.getAll("photos", {
              index: "byTeam",
              key: [team.eventKey, team.teamNumber],
            })
          : tx.getAll("photos"),
      );
      return raw.flatMap((r) => this.parsePhoto(r) ?? []);
    });
  }

  transact<R>(
    team: TeamRef,
    apply: (view: TeamView) => { write: TeamWrite | null; result: R },
  ): Promise<R> {
    const key = entryKey(team.eventKey, team.teamNumber);
    return this.run(() =>
      this.backend.tx(["entries", "photos"], "readwrite", async (tx) => {
        const entry = this.parseEntry(await tx.get("entries", key));
        const photos = (
          await tx.getAll("photos", {
            index: "byTeam",
            key: [team.eventKey, team.teamNumber],
          })
        ).flatMap((r) => this.parsePhoto(r) ?? []);

        let out: { write: TeamWrite | null; result: R };
        try {
          out = apply({ entry, photos });
        } catch (error) {
          throw new CallerError(error);
        }

        const { write } = out;
        if (write) {
          for (const id of write.deletePhotoIds ?? [])
            await tx.delete("photos", id);
          for (const photo of write.putPhotos ?? [])
            await tx.put("photos", photo);
          if (write.entry === null) await tx.delete("entries", key);
          else if (write.entry) await tx.put("entries", write.entry);
        }
        return out.result;
      }),
    );
  }

  getCacheRecord(key: string) {
    return this.run(async () => {
      const raw = await this.backend.tx(["cache"], "readonly", (tx) =>
        tx.get("cache", key),
      );
      const parsed = cacheRecordSchema.safeParse(raw);
      return parsed.success ? (parsed.data as CacheRecord) : undefined;
    });
  }

  putCacheRecord(key: string, record: CacheRecord) {
    return this.run(() =>
      this.backend.tx(["cache"], "readwrite", (tx) =>
        tx.put("cache", record, key),
      ),
    );
  }

  deleteCacheRecord(key: string) {
    return this.run(() =>
      this.backend.tx(["cache"], "readwrite", (tx) => tx.delete("cache", key)),
    );
  }

  listCacheKeys() {
    return this.run(() =>
      this.backend.tx(["cache"], "readonly", (tx) => tx.getAllKeys("cache")),
    );
  }

  clearCache() {
    return this.run(() =>
      this.backend.tx(["cache"], "readwrite", (tx) => tx.clear("cache")),
    );
  }

  getMeta<K extends MetaKey>(key: K) {
    return this.run(async () => {
      const raw = await this.backend.tx(["meta"], "readonly", (tx) =>
        tx.get("meta", key),
      );
      const parsed = metaSchemas[key].safeParse(raw);
      return parsed.success ? (parsed.data as MetaShape[K]) : undefined;
    });
  }

  setMeta<K extends MetaKey>(key: K, value: MetaShape[K]) {
    return this.run(() =>
      this.backend.tx(["meta"], "readwrite", (tx) => tx.put("meta", value, key)),
    );
  }

  clearAll() {
    return this.run(() =>
      this.backend.tx(["entries", "photos", "cache", "meta"], "readwrite", async (tx) => {
        await tx.clear("entries");
        await tx.clear("photos");
        await tx.clear("cache");
        await tx.clear("meta");
      }),
    );
  }

  clearEntriesAndPhotos() {
    return this.run(() =>
      this.backend.tx(["entries", "photos"], "readwrite", async (tx) => {
        await tx.clear("entries");
        await tx.clear("photos");
      }),
    );
  }

  close() {
    this.backend.close();
  }
}
