/**
 * Why a save failed, so the UI (and, in Phase 8, the sync queue) can react:
 *  - "unauthorized": session expired. Keep the data, ask the user to sign in.
 *  - "network":      could not reach Supabase. Retry later.
 *  - "permission":   RLS / grant refused the write. Retrying will not help.
 *  - "invalid":      the database rejected the data (CHECK / FK / type). Retrying will not help.
 *  - "quota":        storage or device quota exceeded.
 *  - "unknown":      anything else. Treat as retryable but surface the message.
 */
export type SaveErrorKind =
  "unauthorized" | "network" | "permission" | "invalid" | "quota" | "unknown";

export class SaveError extends Error {
  constructor(
    public readonly kind: SaveErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SaveError";
  }

  /** Worth trying again later without the user changing anything. */
  get retryable() {
    return this.kind === "network" || this.kind === "unknown";
  }
}

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  name?: unknown;
};

/**
 * Classify a supabase-js error (PostgREST or Storage) or a thrown fetch error.
 * Never exposes raw SQL, constraint or table names in the message.
 */
export function classifySaveError(
  error: unknown,
  httpStatus?: number,
): SaveError {
  if (error instanceof SaveError) return error;

  const e: ErrorLike = typeof error === "object" && error !== null ? error : {};
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  const status = httpStatus ?? numeric(e.status) ?? numeric(e.statusCode);

  if (
    status === 401 ||
    code === "PGRST301" ||
    code === "PGRST303" ||
    /jwt (expired|invalid)/i.test(message)
  ) {
    return new SaveError(
      "unauthorized",
      "Your session expired. Sign in again; your changes are kept.",
    );
  }
  if (e.name === "QuotaExceededError" || /quota/i.test(message)) {
    return new SaveError("quota", "This device is out of storage space.");
  }
  if (code === "42501" || status === 403) {
    return new SaveError(
      "permission",
      "You don't have permission to save this.",
    );
  }
  if (code === "23503") {
    return new SaveError(
      "invalid",
      "This event is not set up in the database yet. Try again.",
    );
  }
  if (
    code === "23514" ||
    code === "22P02" ||
    code === "22003" ||
    status === 400 ||
    status === 413
  ) {
    return new SaveError(
      "invalid",
      "Some of that data isn't allowed. Check the answers and try again.",
    );
  }
  if (
    /fetch|network|failed to|load failed|timeout|offline|aborted/i.test(
      message,
    ) ||
    e.name === "TypeError"
  ) {
    return new SaveError(
      "network",
      "Can't reach the server. Check your connection and try again.",
    );
  }
  return new SaveError(
    "unknown",
    "Something went wrong saving that. Please try again.",
  );
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}
