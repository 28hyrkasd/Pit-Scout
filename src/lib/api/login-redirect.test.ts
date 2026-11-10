import { describe, expect, it } from "vitest";
import { SaveError } from "@/lib/entries/save-error";
import { ApiError } from "./client";
import { loginRedirectUrl } from "./login-redirect";

const here = { pathname: "/teams/254", search: "?tab=photos" };

describe("loginRedirectUrl", () => {
  it("redirects an expired API session to /login, remembering where the scout was", () => {
    expect(loginRedirectUrl(new ApiError("unauthorized", "x"), here, false)).toBe(
      "/login?next=%2Fteams%2F254%3Ftab%3Dphotos",
    );
  });

  it("redirects an expired Supabase session (JWT error) too", () => {
    expect(loginRedirectUrl(new SaveError("unauthorized", "x"), here, false)).toContain("/login?next=");
    expect(loginRedirectUrl({ status: 401, message: "JWT expired" }, here, false)).toContain("/login?next=");
  });

  it("does NOT redirect while the page holds unsaved on-screen edits (a full page load would destroy them)", () => {
    expect(loginRedirectUrl(new ApiError("unauthorized", "x"), here, true)).toBeNull();
    expect(loginRedirectUrl(new SaveError("unauthorized", "x"), here, true)).toBeNull();
  });

  it("ignores every other kind of failure, including being offline", () => {
    expect(loginRedirectUrl(new ApiError("network", "x"), here, false)).toBeNull();
    expect(loginRedirectUrl(new ApiError("upstream", "x"), here, false)).toBeNull();
    expect(loginRedirectUrl(new SaveError("network", "x"), here, false)).toBeNull();
    expect(loginRedirectUrl(new Error("boom"), here, false)).toBeNull();
    expect(loginRedirectUrl(null, here, false)).toBeNull();
    expect(loginRedirectUrl(undefined, here, false)).toBeNull();
  });
});
