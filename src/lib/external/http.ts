import "server-only";
import type * as z from "zod";

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

type Options = {
  headers?: Record<string, string>;
  /** Seconds the framework's persistent fetch cache may serve this response. */
  revalidate: number;
  /** Cache tags, for on-demand revalidation later. */
  tags?: string[];
  /** Abort the upstream call after this many ms so a hung API cannot hang a page. */
  timeoutMs?: number;
};

/**
 * GET + validate + never throw.
 *
 * Every upstream call funnels through here so that:
 *  - responses are validated with zod (a changed/garbled payload becomes a
 *    handled error instead of a crash deep in the UI);
 *  - network errors, timeouts, non-2xx and bad JSON all become `{ ok: false }`;
 *  - callers can degrade to "scouting data only" without try/catch.
 *
 * Uses next.revalidate (persistent fetch cache) rather than `use cache`, because
 * the default `use cache` store is in-memory per instance and does not survive
 * across serverless invocations on Vercel.
 */
export async function getJson<S extends z.ZodType>(
  url: string,
  schema: S,
  { headers, revalidate, tags, timeoutMs = 8000 }: Options,
): Promise<FetchResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      next: { revalidate, tags },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return { ok: false, error: timedOut ? "The data source timed out." : "Could not reach the data source." };
  }

  if (res.status === 404) {
    return { ok: false, status: 404, error: "Not found." };
  }
  if (res.status === 401 || res.status === 403) {
    // Never echo upstream auth details to the client.
    return { ok: false, status: res.status, error: "The data source rejected our credentials." };
  }
  if (res.status === 429) {
    return { ok: false, status: 429, error: "Rate limited by the data source. Try again shortly." };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `The data source returned an error (${res.status}).` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "The data source returned an unreadable response." };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Log the shape problem server-side; the client only gets a generic message.
    console.error("[external] unexpected response shape", url, parsed.error.issues.slice(0, 3));
    return { ok: false, error: "The data source returned unexpected data." };
  }
  return { ok: true, data: parsed.data };
}
