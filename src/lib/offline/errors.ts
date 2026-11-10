import { SaveError } from "@/lib/entries/save-error";

/**
 * IndexedDB cannot be used at all: not supported, blocked (Safari private mode,
 * "Block all cookies"), the connection was killed, or the browser is evicting data.
 * The UI should tell the scout that saving offline is not available on this device
 * and fall back to online-only saving.
 */
export class StorageUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(
    message = "Offline storage isn't available on this device. Changes can only be saved while online.",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export function isStorageUnavailable(
  error: unknown,
): error is StorageUnavailableError {
  return error instanceof StorageUnavailableError;
}

/** The error the UI shows when the DEVICE is out of space. Existing data is untouched (the transaction aborted). */
export function deviceQuotaError(): SaveError {
  return new SaveError(
    "quota",
    "This device is out of storage space. Free some space and try again; everything already saved is safe.",
  );
}

const UNAVAILABLE_NAMES = new Set([
  "SecurityError",
  "InvalidStateError",
  "NotFoundError",
  "UnknownError",
  "AbortError",
  "TransactionInactiveError",
  "VersionError",
]);

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown };

/** Is this the browser telling us the disk/quota is full? (Chrome, Safari, Firefox spellings.) */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as ErrorLike;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    (typeof e.message === "string" && /quota/i.test(e.message))
  );
}

/**
 * Map whatever IndexedDB threw to one of our typed errors:
 *  - quota               -> SaveError("quota")
 *  - cannot open / closed -> StorageUnavailableError
 *  - anything else        -> SaveError("unknown")
 */
export function normalizeStorageError(error: unknown): Error {
  if (error instanceof SaveError || error instanceof StorageUnavailableError)
    return error;
  if (isQuotaError(error)) return deviceQuotaError();
  const name =
    typeof error === "object" && error !== null
      ? (error as ErrorLike).name
      : undefined;
  if (typeof name === "string" && UNAVAILABLE_NAMES.has(name))
    return new StorageUnavailableError(undefined, { cause: error });
  return new SaveError(
    "unknown",
    "Could not read or write the data stored on this device.",
  );
}
