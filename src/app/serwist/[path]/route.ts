import { randomUUID } from "node:crypto";
import { cacheLife } from "next/cache";
import { createSerwistRoute } from "@serwist/turbopack";

// Serves the bundled service worker at /serwist/sw.js (and its source map).
//
// Turbopack ignores webpack plugins, so @serwist/turbopack bundles src/app/sw.ts with
// esbuild inside this Route Handler, which Next prerenders at build time and injects
// the precache manifest (built from .next/static + public/).
//
// createSerwistRoute() also returns `dynamic`, `dynamicParams` and `revalidate`
// route segment configs, which are not allowed with cacheComponents. They are left out
// on purpose: with cacheComponents a GET handler that reads no request data is
// prerendered anyway, and `generateStaticParams` lists the files to emit.

// Changes on every build, so each deploy yields a byte-different SW (the browser
// installs it) and the offline page is re-fetched into the precache.
const REVISION = randomUUID();

const route = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  // esbuild-wasm is the default off Windows; the native binary is faster and installed.
  useNativeEsbuild: true,
  // The default patterns omit fonts (next/font writes .woff2 to _next/static/media).
  globPatterns: [
    ".next/static/**/*.{js,css,woff2,woff,png,jpg,jpeg,svg,webp,avif,ico,json}",
    "public/icons/*.{png,svg}",
    "public/apple-touch-icon.png",
  ],
  additionalPrecacheEntries: [
    // Static, data-free fallback document (public in src/proxy.ts so it can be fetched signed out).
    { url: "/~offline", revision: REVISION },
    { url: "/manifest.webmanifest", revision: REVISION },
  ],
});

export const generateStaticParams = route.generateStaticParams;

// With cacheComponents, a Route Handler that does uncached I/O (esbuild, reading
// .next/static) is not prerendered: it silently becomes a request-time handler that
// would need src/, esbuild and .next/static on the server at runtime. Doing the
// work inside `use cache` with cacheLife("max") makes it a build-time artifact.
async function renderFile(path: string) {
  "use cache";
  cacheLife("max");
  const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ path }) });
  return { body: await response.text(), contentType: response.headers.get("Content-Type") ?? "text/plain" };
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const { body, contentType } = await renderFile(path);
  return new Response(body, {
    headers: { "Content-Type": contentType, "Service-Worker-Allowed": "/" },
  });
}
