import { connection } from "next/server";

/**
 * Connectivity probe for the offline-first UI (ConnectivityMonitor does
 * `HEAD /api/health` and treats any 2xx as "the server is reachable").
 *
 * Public on purpose (no session check): "is the server reachable" must not depend on
 * being signed in, and it returns nothing. src/proxy.ts must exclude this path.
 *
 * With cacheComponents, a GET handler that touches no request data is PRERENDERED at
 * build time, which would answer from a static file and make the probe lie about
 * reachability. `await connection()` opts out so every request runs on the server.
 * (`export const dynamic` is not allowed with cacheComponents.) HEAD is never cached by
 * Next.js, but gets the same treatment so both methods behave identically.
 */
const HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET() {
  await connection();
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function HEAD() {
  await connection();
  return new Response(null, { status: 204, headers: HEADERS });
}
