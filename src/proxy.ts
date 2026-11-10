import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every path except static/PWA assets, which must stay reachable
     * without a session (the browser fetches them before/without cookies, and an
     * installed PWA must be able to load its manifest and service worker):
     *  - _next/static, _next/image
     *  - manifest.webmanifest, favicon.ico, sitemap/robots
     *  - the service worker (/serwist/*, /sw.js) and Workbox/Serwist runtime files
     *  - icons and other image/font assets
     *  - /~offline, the static data-free fallback page the service worker precaches
     *    (it is fetched at install, possibly signed out, and must not become a redirect)
     *  - /api/health, the connectivity probe: "is the server reachable" must not depend
     *    on a session, and a 401 would make the probe report the server as unreachable
     *
     * Note: Server Actions are POSTs to the page that hosts them, so a path
     * excluded here would also skip the proxy for actions on that path. Every
     * Server Action in this app re-checks the session itself (see lib/auth.ts).
     */
    "/((?!_next/static|_next/image|manifest\\.webmanifest|favicon\\.ico|robots\\.txt|sitemap\\.xml|serwist/|sw\\.js|swe-worker.*\\.js|icons/|~offline$|api/health$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
