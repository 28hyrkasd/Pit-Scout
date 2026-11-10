import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { Envelope } from "./schemas";
import type { FetchResult } from "./http";

/**
 * Browser cache lifetime for our own API responses.
 *
 * `private` is essential: these routes are authenticated, and a shared cache
 * (Vercel's CDN) must never serve one user's response to someone else, nor
 * cache a response made while signed in. The browser may reuse it briefly, which
 * also helps on bad venue wifi. stale-while-revalidate lets the UI show the last
 * answer instantly while refreshing in the background.
 */
export function cacheControl(maxAgeSeconds: number) {
  return `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 5}`;
}

/** 401 for signed-out callers. Handlers must call this before touching upstream APIs. */
export async function requireApiUser(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (user) return null;
  return NextResponse.json(
    { ok: false, data: null, error: "Not signed in.", fetchedAt: new Date().toISOString() } satisfies Envelope<never>,
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, data: null, error: message, fetchedAt: new Date().toISOString() } satisfies Envelope<never>,
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Turn an upstream result into a response.
 *
 * Upstream failure is returned as HTTP 200 with ok:false (not a 5xx) on purpose:
 * the route itself worked, and the client is expected to degrade gracefully to
 * scouting data only. A 404 from upstream stays a 404 so "event does not exist"
 * is distinguishable. Failures are never cached.
 */
export function respond<T>(result: FetchResult<T>, maxAgeSeconds: number) {
  const fetchedAt = new Date().toISOString();
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data, error: null, fetchedAt } satisfies Envelope<T>, {
      headers: { "Cache-Control": cacheControl(maxAgeSeconds) },
    });
  }
  return NextResponse.json({ ok: false, data: null, error: result.error, fetchedAt } satisfies Envelope<T>, {
    status: result.status === 404 ? 404 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
