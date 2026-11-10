import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Next.js compiles `matcher` with path-to-regexp; this pattern is a plain negative
// lookahead, so anchoring it as a RegExp is an accurate emulation.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const runsProxy = (path: string) => matcher.test(path);

describe("proxy matcher", () => {
  it.each([
    "/",
    "/settings",
    "/teams/254",
    "/teams/254/edit",
    "/login",
    "/api/tba/events/2026",
    "/api/statbotics/event/2026casj",
    "/api/healthy",
  ])("runs the session proxy for %s", (path) => {
    expect(runsProxy(path)).toBe(true);
  });

  it.each([
    "/serwist/sw.js",
    "/serwist/sw.js.map",
    "/manifest.webmanifest",
    "/~offline",
    "/api/health",
    "/icons/icon-192.png",
    "/apple-touch-icon.png",
    "/favicon.ico",
    "/_next/static/chunks/abc.js",
    "/_next/image",
  ])("skips the session proxy for %s", (path) => {
    expect(runsProxy(path)).toBe(false);
  });
});
