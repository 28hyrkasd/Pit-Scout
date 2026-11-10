/**
 * Pure request/response classification for the service worker (src/app/sw.ts).
 *
 * Kept free of service-worker globals so the privacy-critical decisions (what may
 * be cached, what must never be) are unit-tested in plain Node. See the
 * "Offline & PWA" section of the README for the reasoning behind each rule.
 */

/** Static, public document served when nothing better is cached. Precached. */
export const OFFLINE_FALLBACK_URL = "/~offline";

/** Prefix of the page-document caches. Each SW build uses its own suffix. */
export const PAGES_CACHE_PREFIX = "pit-pages-";

/** Cache of long-lived hashed build assets that are not in the precache manifest. */
export const STATIC_CACHE_NAME = "pit-static-assets";

/**
 * Hosts whose responses are private (auth tokens, signed storage URLs) and must
 * never be stored. `*.supabase.co` also covers storage signed URLs. Anything
 * cross-origin is left to the network anyway; this list makes the rule explicit
 * and survives a future broadening of the runtime caching.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "supabase.co" || host.endsWith(".supabase.co") || host.endsWith(".supabase.in") || host.endsWith(".supabase.net");
}

/** `/api/*`, including the `/api/health` connectivity probe. Never cached. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The sign-in page and anything under it. Never cached, never served as an app route. */
export function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

/**
 * Next.js soft-navigation / prefetch requests (React Server Component payloads).
 * They are NetworkOnly: the payload varies by request headers (router state,
 * prefetch segment) and by session, so caching it by URL would poison later
 * navigations. When offline they fail fast and Next falls back to a normal
 * document navigation, which the service worker does answer from cache.
 */
export function isRscRequest(request: { headers: Headers }, url: URL): boolean {
  return (
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-segment-prefetch") ||
    url.searchParams.has("_rsc")
  );
}

/**
 * A top-level HTML navigation to an app route that is worth caching/serving
 * offline: same origin, not an API/service-worker/login path.
 */
export function isAppNavigation(request: { mode: string; method: string }, url: URL, origin: string): boolean {
  if (request.mode !== "navigate" || request.method !== "GET") return false;
  if (url.origin !== origin) return false;
  if (isApiPath(url.pathname) || isLoginPath(url.pathname)) return false;
  if (url.pathname.startsWith("/serwist/") || url.pathname.startsWith("/_next/")) return false;
  return true;
}

/**
 * Whether a network response to an app navigation may be stored for offline use.
 *
 * Only a plain 200 HTML document that was NOT the result of a redirect: a
 * redirect to /login (signed out) must never become the cached answer for an
 * app route, and an opaque redirect is not even readable.
 */
export function isCacheablePageResponse(response: {
  status: number;
  type: string;
  redirected: boolean;
  headers: Headers;
  url?: string;
}): boolean {
  if (response.status !== 200) return false;
  if (response.type !== "basic") return false;
  if (response.redirected) return false;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return false;
  if (response.url) {
    try {
      if (isLoginPath(new URL(response.url).pathname)) return false;
    } catch {
      // Not a parseable URL: nothing to compare, keep the other checks.
    }
  }
  return true;
}

/** A redirect to somewhere else: for an app route that means "signed out". */
export function isRedirectResponse(response: { type: string; redirected: boolean }): boolean {
  return response.type === "opaqueredirect" || response.redirected;
}

/**
 * Cache key for a page: origin + pathname, no query string or hash. Query strings
 * on app routes are not meaningful (and `?next=` style params must not fragment
 * the cache); a trailing slash is normalised away.
 */
export function pageCacheKey(url: URL): string {
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${url.origin}${pathname}`;
}

/** Stable short hash of a string (FNV-1a, base 36). Used to name per-build caches. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Server Action calls are POSTs carrying the `next-action` header. */
export function isServerActionRequest(request: { method: string; headers: Headers }): boolean {
  return request.method === "POST" && request.headers.has("next-action");
}

/**
 * Team routes (`/teams/254`, `/teams/254/edit`) share one prerendered shell; only the
 * team number differs, and it appears in the document as a quoted flight-payload token
 * (`\"254\"`). That lets one cached team page answer every team number offline.
 */
const TEAM_ROUTE = /^\/teams\/(\d{1,5})(\/edit)?$/;

/** Team number used only to seed shells (warmed pages). Any number would do. */
export const SEED_TEAM = "9999";

/** Pages fetched ahead of time so a first offline launch has shells to serve. */
export const WARM_PATHS = ["/", "/settings", `/teams/${SEED_TEAM}`, `/teams/${SEED_TEAM}/edit`] as const;

export function parseTeamRoute(pathname: string): { team: string; suffix: "" | "/edit" } | null {
  const match = TEAM_ROUTE.exec(pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);
  if (!match) return null;
  return { team: match[1], suffix: match[2] ? "/edit" : "" };
}

/**
 * Re-targets a cached team-page document from team `from` to team `to`.
 *
 * Returns null unless the document clearly is a team shell (at least two quoted
 * occurrences of the number: the route key and the canonical path). A null makes the
 * caller fall back to the generic offline page instead of serving a broken document.
 */
export function retargetTeamShell(html: string, from: string, to: string): string | null {
  if (!/^\d{1,5}$/.test(from) || !/^\d{1,5}$/.test(to)) return null;
  const token = `\\"${from}\\"`;
  const occurrences = html.split(token).length - 1;
  if (occurrences < 2) return null;
  return html.split(token).join(`\\"${to}\\"`);
}
