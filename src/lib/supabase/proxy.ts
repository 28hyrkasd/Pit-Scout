import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/** Paths reachable without a session. Everything else requires sign-in. */
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session (so it does not expire mid-event) and enforces
 * the sign-in redirect.
 *
 * Rules from the Supabase SSR guide that matter here:
 *  - verify with getClaims(), never trust getSession() on the server;
 *  - the response returned MUST be the last `supabaseResponse` built by setAll,
 *    otherwise the refreshed cookies are lost and the user is signed out;
 *  - when returning a redirect, copy the refreshed cookies onto it.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { supabaseUrl, supabaseKey } = getPublicEnv();
  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  // Same rule as getCurrentUser() in lib/auth.ts: a session needs a subject. If the two disagreed, a page could
  // load while every API call and server-side check answered "not signed in".
  const isSignedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && !isPublicPath(pathname)) {
    // API callers (fetch / TanStack Query / the offline sync queue) need a real
    // 401 they can act on. A 307 to the HTML login page would be followed
    // silently and then fail as an unparseable response, which a sync queue
    // could mistake for a network error instead of "session expired".
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, data: null, error: "Not signed in.", fetchedAt: new Date().toISOString() },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return redirectWithCookies(request, supabaseResponse, "/login", {
      next: pathname === "/" ? undefined : pathname + request.nextUrl.search,
    });
  }

  if (isSignedIn && pathname === "/login") {
    return redirectWithCookies(request, supabaseResponse, "/");
  }

  return supabaseResponse;
}

function redirectWithCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  params?: Record<string, string | undefined>,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
