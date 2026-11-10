import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("allows in-app paths, preserving query and hash", () => {
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath("/teams/254")).toBe("/teams/254");
    expect(safeRedirectPath("/teams/254?tab=photos")).toBe("/teams/254?tab=photos");
    expect(safeRedirectPath("/settings#fields")).toBe("/settings#fields");
  });

  it("falls back for empty values", () => {
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath("", "/home")).toBe("/home");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/");
    expect(safeRedirectPath("http://evil.example/teams")).toBe("/");
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("///evil.example")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects backslash and control-character tricks", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("/foo\\bar")).toBe("/");
    expect(safeRedirectPath("/foo\nbar")).toBe("/");
    expect(safeRedirectPath("/foo\tbar")).toBe("/");
    expect(safeRedirectPath("/\u0000")).toBe("/");
  });

  it("never redirects back to the login page", () => {
    expect(safeRedirectPath("/login")).toBe("/");
    expect(safeRedirectPath("/login?next=/x")).toBe("/");
    expect(safeRedirectPath("/login/anything")).toBe("/");
  });

  it("does not treat a lookalike path as login", () => {
    expect(safeRedirectPath("/loginx")).toBe("/loginx");
  });
});
