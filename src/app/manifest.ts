import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. The route is static (no request-time APIs), so it
// is prerendered at build time, which is fine under cacheComponents. src/proxy.ts
// excludes this path so it is reachable without a session.
//
// Icons live in /public (see scripts/generate-icons.mjs); the proxy matcher lets
// /icons/* through signed-out.
//
// Colours: the manifest only has one value, so it follows the light theme
// (--background is white). <meta name="theme-color"> in layout.tsx handles dark mode.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pit Scout",
    short_name: "Pit Scout",
    description: "Scout FRC robots in the pits, even with bad venue wifi.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity", "sports", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
