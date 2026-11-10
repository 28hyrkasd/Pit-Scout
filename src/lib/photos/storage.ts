import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { classifySaveError } from "@/lib/entries/save-error";

export const PHOTO_BUCKET = "robot-photos";
/** Thumbnails are viewed during the event; an hour is long enough and short enough. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

type ErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
  error?: unknown;
};

/**
 * "This object is already in the bucket", which for a retried upload means the
 * previous attempt actually succeeded.
 *
 * Supabase Storage reports a duplicate inconsistently: the JSON body says
 * statusCode "409" / error "Duplicate" / "The resource already exists", while the
 * HTTP status itself is 400 on some versions. Check every signal.
 */
export function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as ErrorLike;
  return (
    String(e.statusCode) === "409" ||
    e.status === 409 ||
    e.error === "Duplicate" ||
    (typeof e.message === "string" &&
      /already exists|duplicate/i.test(e.message))
  );
}

/** Postgres unique_violation: the row with this client-generated id is already there. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

type Client = Pick<SupabaseClient<Database>, "storage" | "from">;

/**
 * Upload with upsert:false. The path is deterministic per photo id, so a retry
 * after an interrupted upload hits "already exists", which is success.
 */
export async function uploadPhotoObject(
  client: Pick<Client, "storage">,
  path: string,
  blob: Blob,
): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, {
    upsert: false,
    contentType: "image/jpeg",
    cacheControl: "31536000", // object names are unique per photo, so they never change
  });
  if (!error) return;
  if (isAlreadyExistsError(error)) return;
  throw classifySaveError(error);
}

export async function insertPhotoRow(
  client: Pick<Client, "from">,
  row: { id: string; entryId: string; storagePath: string },
): Promise<void> {
  const { error, status } = await client
    .from("entry_photos")
    .insert({
      id: row.id,
      entry_id: row.entryId,
      storage_path: row.storagePath,
    });
  if (!error || isUniqueViolation(error)) return; // already inserted by an earlier attempt
  throw classifySaveError(error, status);
}

export async function deletePhotoRow(
  client: Pick<Client, "from">,
  id: string,
): Promise<void> {
  const { error, status } = await client
    .from("entry_photos")
    .delete()
    .eq("id", id);
  if (error) throw classifySaveError(error, status);
}

export async function deletePhotoObject(
  client: Pick<Client, "storage">,
  path: string,
): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) throw classifySaveError(error);
}

export type PhotoRecord = { id: string; entryId: string; storagePath: string };

export async function listEntryPhotos(
  client: Pick<Client, "from">,
  entryId: string,
): Promise<PhotoRecord[]> {
  const { data, error, status } = await client
    .from("entry_photos")
    .select("id, entry_id, storage_path, created_at")
    .eq("entry_id", entryId)
    .order("created_at")
    .order("id");
  if (error) throw classifySaveError(error, status);
  return (data ?? []).map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    storagePath: r.storage_path,
  }));
}

/**
 * Signed URLs for private photos, returned as a path -> url map. A path that could
 * not be signed (object missing, e.g. an upload that never finished) is simply
 * absent from the map, and the UI shows a placeholder instead of failing the page.
 */
export async function signPhotoUrls(
  client: Pick<Client, "storage">,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw classifySaveError(error);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error)
      urls.set(item.path, item.signedUrl);
  }
  return urls;
}
