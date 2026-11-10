/// <reference lib="webworker" />
// Service worker source, bundled by esbuild through @serwist/turbopack's route
// handler (src/app/serwist/[path]/route.ts) and served at /serwist/sw.js.
// Type-checked separately (tsconfig.sw.json): the DOM and webworker libs conflict.
//
// Privacy model (shared team phones, authenticated app): only build assets and
// signed-out-safe public documents are precached. Authenticated page HTML is cached
// per URL for offline launch but purged on sign-in/out, session loss and update.
// Data, API, auth and Supabase traffic is never stored. Details: README, "Offline & PWA".
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";
import {
  isApiPath,
  isAppNavigation,
  isCacheablePageResponse,
  isLoginPath,
  isPrivateHost,
  isRedirectResponse,
  isRscRequest,
  isServerActionRequest,
  parseTeamRoute,
  OFFLINE_FALLBACK_URL,
  PAGES_CACHE_PREFIX,
  pageCacheKey,
  retargetTeamShell,
  shortHash,
  STATIC_CACHE_NAME,
  WARM_PATHS,
} from "../lib/sw/policy";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const manifest = self.__SW_MANIFEST ?? [];

/** Page documents are cached per SW build: HTML references that build's hashed chunks. */
const PAGES_CACHE = `${PAGES_CACHE_PREFIX}${shortHash(JSON.stringify(manifest))}`;
/** How long an unsaved page may take before the fallback is shown (a team shell is a good stand-in, so be quick). */
const TEAM_SHELL_TIMEOUT_MS = 3000;
const UNSAVED_PAGE_TIMEOUT_MS = 8000;
const MATCH_OPTIONS: CacheQueryOptions = { ignoreSearch: true, ignoreVary: true };

async function purgePages(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(PAGES_CACHE_PREFIX)).map((n) => caches.delete(n)));
}

/**
 * Fetches shells that are not cached yet (home, settings, one team page and its edit
 * page) so a first offline launch has something to serve, and so any team number can be
 * answered by retargeting a cached team page (see teamShellFor). Best effort.
 */
async function warmPages(): Promise<void> {
  const cache = await caches.open(PAGES_CACHE);
  await Promise.all(
    WARM_PATHS.map(async (path) => {
      const key = pageCacheKey(new URL(path, self.location.origin));
      if (await cache.match(key, MATCH_OPTIONS)) return;
      try {
        // Same-origin, with cookies. `manual` so a signed-out redirect is seen, not followed.
        const response = await fetch(path, { redirect: "manual", cache: "reload" });
        if (isCacheablePageResponse(response)) await cache.put(key, response);
      } catch {
        // Offline or server down: warming must never fail the install or the navigation.
      }
    }),
  );
}

/**
 * Offline answer for a team route that was never opened on this device: take any cached
 * team page of the same kind and retarget it to the requested team number.
 */
async function teamShellFor(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const wanted = parseTeamRoute(url.pathname);
  if (!wanted) return null;
  const cache = await caches.open(PAGES_CACHE);
  for (const key of await cache.keys()) {
    const candidate = parseTeamRoute(new URL(key.url).pathname);
    if (!candidate || candidate.suffix !== wanted.suffix) continue;
    const cached = await cache.match(key);
    if (!cached) continue;
    const html = retargetTeamShell(await cached.text(), candidate.team, wanted.team);
    if (html === null) continue;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return null;
}

/** What to show when a page cannot be loaded and was never saved: a retargeted team shell, else /~offline. */
async function offlineAnswer(request: Request): Promise<Response> {
  return (await teamShellFor(request)) ?? (await serwist.matchPrecache(OFFLINE_FALLBACK_URL)) ?? Response.error();
}

/** Never let a redirect (signed out) or non-page response become the cached answer. */
const pagePlugin: SerwistPlugin = {
  cacheKeyWillBeUsed: async ({ request }) => pageCacheKey(new URL(request.url)),
  cacheWillUpdate: async ({ response }) => (isCacheablePageResponse(response) ? response : null),
  cacheDidUpdate: async ({ event }) => {
    // First good page of this build: fill in the other shells in the background.
    event.waitUntil(warmPages());
  },
  fetchDidSucceed: async ({ response }) => {
    // An app route that now redirects means the session is gone: forget every cached page.
    if (isRedirectResponse(response)) await purgePages();
    return response;
  },
};

const pages = new NetworkFirst({
  cacheName: PAGES_CACHE,
  networkTimeoutSeconds: 3,
  matchOptions: MATCH_OPTIONS,
  plugins: [pagePlugin],
});

const runtimeCaching: RuntimeCaching[] = [
  // Private data: never cached. `/api/health` is the connectivity probe and must always hit the network.
  { matcher: ({ sameOrigin, url }) => sameOrigin && isApiPath(url.pathname), handler: new NetworkOnly() },
  // Supabase (auth tokens, REST, signed storage URLs for private photos).
  { matcher: ({ url }) => isPrivateHost(url.hostname), handler: new NetworkOnly() },
  // The image optimizer can proxy signed URLs; treat it as private.
  { matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/image"), handler: new NetworkOnly() },
  // Next.js RSC (soft navigation / prefetch) payloads: never cached.
  { matcher: ({ request, url }) => isRscRequest(request, url), handler: new NetworkOnly() },
  // Sign-in page: always fresh, never cached.
  { matcher: ({ request, sameOrigin, url }) => request.mode === "navigate" && sameOrigin && isLoginPath(url.pathname), handler: new NetworkOnly() },
  // Hashed build assets that are not in the precache (e.g. chunks of an older build still referenced by old HTML).
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: STATIC_CACHE_NAME,
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60, maxAgeFrom: "last-used" })],
    }),
  },
  // App navigations: network first, but "up but dead" venue wifi falls back to the last good page after 3 s.
  {
    matcher: ({ request, url }) => isAppNavigation(request, url, self.location.origin),
    handler: async (options) => {
      const { request } = options;
      const url = new URL(request.url);
      const cached = await (await caches.open(PAGES_CACHE)).match(pageCacheKey(url), MATCH_OPTIONS);
      const answer = pages.handle(options).catch(() => offlineAnswer(request));
      // A saved copy is served by NetworkFirst itself after 3 s. With no copy, NetworkFirst would wait
      // for a dead network indefinitely, so give up after a while and show a shell / the offline page.
      if (cached) return answer;
      const patience = parseTeamRoute(url.pathname) ? TEAM_SHELL_TIMEOUT_MS : UNSAVED_PAGE_TIMEOUT_MS;
      const giveUp = new Promise<Response>((resolve) => setTimeout(() => resolve(offlineAnswer(request)), patience));
      return Promise.race([answer, giveUp]);
    },
  },
];

const serwist = new Serwist({
  precacheEntries: manifest,
  // Do not skipWaiting: a mid-scouting update must not swap assets under an open form.
  // The new worker waits until the next launch, or until the user taps "Reload" (SKIP_WAITING message).
  skipWaiting: false,
  // Claim on first install so the very first page load is already offline-capable.
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: OFFLINE_FALLBACK_URL,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// Warm shells when a new worker installs (waitUntil keeps the install open until done).
self.addEventListener("install", (event) => {
  event.waitUntil(warmPages());
});

// Drop page caches of other builds: their HTML points at chunks this build no longer precaches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PAGES_CACHE_PREFIX) && n !== PAGES_CACHE).map((n) => caches.delete(n)))),
  );
});

// Sign-in / sign-out are Server Actions (POST). Whoever uses the app next must not be
// shown the previous session's cached pages, so forget them once the action finished.
self.addEventListener("fetch", (event) => {
  if (!isServerActionRequest(event.request)) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } finally {
        await purgePages();
      }
    })(),
  );
});

// Lets the app clear page caches explicitly (e.g. a "clear offline data" action).
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PAGE_CACHES") event.waitUntil(purgePages());
});
