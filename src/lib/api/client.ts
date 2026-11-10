import * as z from "zod";

/**
 * Why a request failed, so the UI can react differently:
 *  - "unauthorized": session expired -> send the user to /login.
 *  - "network":      fetch itself failed (offline / venue wifi) -> keep showing cached data.
 *  - "upstream":     our server worked but TBA/Statbotics did not -> show scouting data only.
 *  - "not_found":    the event/team does not exist.
 *  - "invalid":      the response was not the shape we expect (bug or proxy interference).
 */
export type ApiErrorKind = "unauthorized" | "network" | "upstream" | "not_found" | "invalid";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The wire format of every route handler. `data` is validated by the caller's
 * schema, so whether `null` is acceptable is decided per route (the team-status
 * route allows it; the team list does not), instead of being waved through here.
 */
function wireSchema<S extends z.ZodType>(dataSchema: S) {
  return z.object({
    ok: z.boolean(),
    data: z.unknown(),
    error: z.string().nullable(),
    fetchedAt: z.string(),
  }).transform((wire, ctx) => {
    if (!wire.ok) return { ok: false as const, error: wire.error, fetchedAt: wire.fetchedAt };
    const data = dataSchema.safeParse(wire.data);
    if (!data.success) {
      ctx.addIssue({ code: "custom", message: "payload does not match the expected schema" });
      return z.NEVER;
    }
    return { ok: true as const, data: data.data as z.infer<S>, fetchedAt: wire.fetchedAt };
  });
}

/**
 * GET a route handler and validate the envelope + payload with zod.
 * Resolves with the data, or throws ApiError (which TanStack Query surfaces as `error`).
 */
export async function apiGet<S extends z.ZodType>(
  path: string,
  dataSchema: S,
  signal?: AbortSignal,
): Promise<{ data: z.infer<S>; fetchedAt: string }> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: "application/json" }, credentials: "same-origin" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", "You appear to be offline.");
  }

  if (res.status === 401) throw new ApiError("unauthorized", "Your session expired. Please sign in again.");

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Not JSON: typically a captive-portal / venue wifi login page returning HTML.
    throw new ApiError("network", "The network returned an unexpected page. Check your wifi connection.");
  }

  const parsed = wireSchema(dataSchema).safeParse(body);
  if (!parsed.success) throw new ApiError("invalid", "The server returned unexpected data.");

  const result = parsed.data;
  if (res.status === 404) throw new ApiError("not_found", (!result.ok && result.error) || "Not found.");
  if (!result.ok) throw new ApiError("upstream", result.error ?? "The data source is unavailable.");
  return { data: result.data, fetchedAt: result.fetchedAt };
}
