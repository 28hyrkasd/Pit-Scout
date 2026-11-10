import imageCompression from "browser-image-compression";

/** Longest edge, in pixels. Plenty to read a bumper number; small enough for venue wifi. */
export const PHOTO_MAX_EDGE = 1600;
/** Upload ceiling. The compressor aims for 0.8 MB, so this is a safety net, not the target. */
export const PHOTO_MAX_BYTES = 1_000_000;
const TARGET_MB = 0.8;

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/**
 * Pure check on the compressor's output: it must be a JPEG under the size
 * ceiling, otherwise the upload would be rejected by the bucket (or be wastefully
 * large) and the scout would find out only after a slow upload attempt.
 */
export function assertUploadable(file: Pick<Blob, "type" | "size">): void {
  if (file.type !== "image/jpeg")
    throw new PhotoError("That photo could not be converted to JPEG.");
  if (file.size === 0) throw new PhotoError("That photo is empty.");
  if (file.size > PHOTO_MAX_BYTES)
    throw new PhotoError(
      "That photo is still too large after compressing. Try a smaller one.",
    );
}

/**
 * Shrink a camera photo to a JPEG of at most ~1600px and ~0.8 MB BEFORE it is
 * saved or uploaded.
 *
 * useWebWorker is deliberately false. With it on, browser-image-compression loads
 * its worker script from cdn.jsdelivr.net at runtime: that fails offline, hangs
 * when the wifi is up but the internet is not (exactly the venue case), and is a
 * third-party script on a page that holds a session. Compressing on the main
 * thread costs a short pause per photo and has no network dependency.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/"))
    throw new PhotoError("That file is not an image.");

  let compressed: File;
  try {
    compressed = await imageCompression(file, {
      maxSizeMB: TARGET_MB,
      maxWidthOrHeight: PHOTO_MAX_EDGE,
      fileType: "image/jpeg",
      initialQuality: 0.8,
      useWebWorker: false,
    });
  } catch {
    // Typically a format the browser cannot decode (HEIC on a desktop browser).
    throw new PhotoError("Could not read that photo. Try taking it again.");
  }

  assertUploadable(compressed);
  return compressed;
}
