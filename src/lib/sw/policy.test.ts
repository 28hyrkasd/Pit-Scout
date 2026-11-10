import { describe, expect, it } from "vitest";
import {
  isApiPath,
  isAppNavigation,
  isCacheablePageResponse,
  isLoginPath,
  isPrivateHost,
  isRedirectResponse,
  isRscRequest,
  isServerActionRequest,
  pageCacheKey,
  parseTeamRoute,
  retargetTeamShell,
  shortHash,
} from "./policy";

const ORIGIN = "https://scout.example.test";
const u = (path: string) => new URL(path, ORIGIN);
const html = (init: Partial<Parameters<typeof isCacheablePageResponse>[0]> = {}) => ({
  status: 200,
  type: "basic",
  redirected: false,
  headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
  ...init,
});

describe("path classification", () => {
  it("treats /api and /api/health as API paths, but not lookalikes", () => {
    expect(isApiPath("/api/health")).toBe(true);
    expect(isApiPath("/api/tba/events/2026")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/teams/api")).toBe(false);
  });

  it("matches the login page and its children only", () => {
    expect(isLoginPath("/login")).toBe(true);
    expect(isLoginPath("/login/reset")).toBe(true);
    expect(isLoginPath("/loginx")).toBe(false);
  });

  it("marks Supabase hosts private (including storage signed URLs)", () => {
    expect(isPrivateHost("abcd1234.supabase.co")).toBe(true);
    expect(isPrivateHost("abcd1234.supabase.co".toUpperCase())).toBe(true);
    expect(isPrivateHost("supabase.co")).toBe(true);
    expect(isPrivateHost("evilsupabase.co")).toBe(false);
    expect(isPrivateHost("scout.example.test")).toBe(false);
  });
});

describe("request classification", () => {
  it("recognises RSC / prefetch requests by header or _rsc param", () => {
    expect(isRscRequest({ headers: new Headers({ RSC: "1" }) }, u("/teams/254"))).toBe(true);
    expect(isRscRequest({ headers: new Headers({ "Next-Router-Prefetch": "1" }) }, u("/"))).toBe(true);
    expect(isRscRequest({ headers: new Headers() }, u("/settings?_rsc=abc"))).toBe(true);
    expect(isRscRequest({ headers: new Headers({ accept: "text/html" }) }, u("/settings"))).toBe(false);
  });

  it("only offline-serves GET document navigations to app routes", () => {
    const nav = { mode: "navigate", method: "GET" };
    expect(isAppNavigation(nav, u("/"), ORIGIN)).toBe(true);
    expect(isAppNavigation(nav, u("/teams/254/edit"), ORIGIN)).toBe(true);
    expect(isAppNavigation(nav, u("/login"), ORIGIN)).toBe(false);
    expect(isAppNavigation(nav, u("/api/health"), ORIGIN)).toBe(false);
    expect(isAppNavigation(nav, u("/serwist/sw.js"), ORIGIN)).toBe(false);
    expect(isAppNavigation(nav, new URL("https://other.test/"), ORIGIN)).toBe(false);
    expect(isAppNavigation({ mode: "cors", method: "GET" }, u("/"), ORIGIN)).toBe(false);
    expect(isAppNavigation({ mode: "navigate", method: "POST" }, u("/"), ORIGIN)).toBe(false);
  });

  it("detects Server Action POSTs", () => {
    expect(isServerActionRequest({ method: "POST", headers: new Headers({ "Next-Action": "abc" }) })).toBe(true);
    expect(isServerActionRequest({ method: "POST", headers: new Headers() })).toBe(false);
    expect(isServerActionRequest({ method: "GET", headers: new Headers({ "next-action": "abc" }) })).toBe(false);
  });
});

describe("what may be cached", () => {
  it("accepts a plain 200 HTML document", () => {
    expect(isCacheablePageResponse(html())).toBe(true);
  });

  it("rejects redirects, non-200, non-HTML, opaque and login documents", () => {
    expect(isCacheablePageResponse(html({ redirected: true }))).toBe(false);
    expect(isCacheablePageResponse(html({ type: "opaqueredirect", status: 0 }))).toBe(false);
    expect(isCacheablePageResponse(html({ status: 500 }))).toBe(false);
    expect(isCacheablePageResponse(html({ status: 304 }))).toBe(false);
    expect(isCacheablePageResponse(html({ headers: new Headers({ "content-type": "application/json" }) }))).toBe(false);
    expect(isCacheablePageResponse(html({ url: `${ORIGIN}/login?next=%2Fsettings` }))).toBe(false);
    expect(isCacheablePageResponse(html({ url: `${ORIGIN}/settings` }))).toBe(true);
  });

  it("flags redirects as a signed-out signal", () => {
    expect(isRedirectResponse({ type: "opaqueredirect", redirected: false })).toBe(true);
    expect(isRedirectResponse({ type: "basic", redirected: true })).toBe(true);
    expect(isRedirectResponse({ type: "basic", redirected: false })).toBe(false);
  });

  it("keys pages by origin + path only", () => {
    expect(pageCacheKey(u("/teams/254?next=1#x"))).toBe(`${ORIGIN}/teams/254`);
    expect(pageCacheKey(u("/teams/254/"))).toBe(`${ORIGIN}/teams/254`);
    expect(pageCacheKey(u("/"))).toBe(`${ORIGIN}/`);
  });

  it("hashes deterministically", () => {
    expect(shortHash("a")).toBe(shortHash("a"));
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });
});

describe("team shells", () => {
  it("parses team routes", () => {
    expect(parseTeamRoute("/teams/254")).toEqual({ team: "254", suffix: "" });
    expect(parseTeamRoute("/teams/1678/edit")).toEqual({ team: "1678", suffix: "/edit" });
    expect(parseTeamRoute("/teams/1678/edit/")).toEqual({ team: "1678", suffix: "/edit" });
    expect(parseTeamRoute("/teams/abc")).toBeNull();
    expect(parseTeamRoute("/teams/123456")).toBeNull();
    expect(parseTeamRoute("/teams/254/photos")).toBeNull();
    expect(parseTeamRoute("/")).toBeNull();
  });

  const doc =
    'x{\\"k\\":\\"254\\"}y{\\"c\\":[\\"\\",\\"teams\\",\\"254\\",\\"edit\\"]}z{\\"rawTeamNumber\\":\\"254\\"} Team 254 <a href="/teams/254">';

  it("retargets only the quoted team tokens", () => {
    const out = retargetTeamShell(doc, "254", "1678");
    expect(out).not.toBeNull();
    expect(out).toContain('\\"k\\":\\"1678\\"');
    expect(out).toContain('\\"rawTeamNumber\\":\\"1678\\"');
    expect(out).not.toContain('\\"254\\"');
    // Plain-text occurrences are left alone.
    expect(out).toContain("Team 254");
  });

  it("refuses documents that do not look like a team shell, or bad numbers", () => {
    expect(retargetTeamShell("<html>nothing here</html>", "254", "1678")).toBeNull();
    expect(retargetTeamShell('only one \\"254\\" token', "254", "1678")).toBeNull();
    expect(retargetTeamShell(doc, "254", "../etc")).toBeNull();
    expect(retargetTeamShell(doc, "25x", "1678")).toBeNull();
  });
});
