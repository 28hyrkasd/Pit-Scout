import type { LocalPhoto } from "@/lib/offline/types";

/** A photo to show: already on the server, or still only on this device. */
export type DisplayPhoto = {
  id: string;
  url: string | null;
  source: "server" | "local";
  /** Local photos only: where the upload stands. */
  uploadStatus: "pending" | "uploading" | "failed" | null;
  /** Server photos only: no URL because we could not reach the server (not because the object is gone). */
  unavailableOffline: boolean;
};

export type ServerPhotoView = { id: string; url: string | null; offline?: boolean };

/**
 * One list of photos for a team: the server's, minus any this device has queued for
 * removal, plus the ones only this device has (waiting to upload).
 *
 *  - A queued removal hides the server photo immediately (the row is deleted at the next sync).
 *  - A local upload whose id the server already lists is shown once, as the server's.
 *  - A local record that is `uploaded` (its blob was dropped) is skipped: the server list has it.
 *  - Local blobs are shown through `previewUrls` (object URLs created by the UI); a missing URL
 *    shows as a placeholder rather than disappearing.
 */
export function mergePhotos(args: {
  server: readonly ServerPhotoView[];
  local: readonly Pick<LocalPhoto, "id" | "kind" | "status" | "blob">[];
  previewUrls: ReadonlyMap<string, string>;
}): DisplayPhoto[] {
  const removed = new Set(args.local.filter((p) => p.kind === "removal").map((p) => p.id));
  const serverIds = new Set(args.server.map((p) => p.id));

  const fromServer = args.server
    .filter((p) => !removed.has(p.id))
    .map(
      (p): DisplayPhoto => ({
        id: p.id,
        url: p.url,
        source: "server",
        uploadStatus: null,
        unavailableOffline: p.url === null && p.offline === true,
      }),
    );

  const fromLocal = args.local
    .filter((p) => p.kind === "upload" && p.status !== "uploaded" && !serverIds.has(p.id) && !removed.has(p.id))
    .map(
      (p): DisplayPhoto => ({
        id: p.id,
        url: args.previewUrls.get(p.id) ?? null,
        source: "local",
        uploadStatus: p.status === "uploaded" ? null : p.status,
        unavailableOffline: false,
      }),
    );

  return [...fromServer, ...fromLocal];
}

/** The words on a photo tile: a status line (or null) and what to say when there is no picture to show. */
export function describePhotoTile(photo: DisplayPhoto): { status: string | null; placeholder: string } {
  if (photo.source === "local") {
    return {
      status:
        photo.uploadStatus === "failed"
          ? "Upload failed"
          : photo.uploadStatus === "uploading"
            ? "Uploading…"
            : "Uploads when online",
      placeholder: "Photo saved on this device",
    };
  }
  return {
    status: null,
    placeholder: photo.unavailableOffline ? "Photo unavailable offline" : "Photo unavailable",
  };
}
