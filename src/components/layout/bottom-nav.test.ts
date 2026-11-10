import { describe, expect, it } from "vitest";
import { isActive } from "./bottom-nav";

describe("isActive", () => {
  it("home is active only on / and team pages, not on other sections", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/teams/254", "/")).toBe(true);
    expect(isActive("/teams/254/edit", "/")).toBe(true);
    expect(isActive("/settings", "/")).toBe(false);
  });

  it("a section is active on itself and its children, not on lookalikes", () => {
    expect(isActive("/settings", "/settings")).toBe(true);
    expect(isActive("/settings/anything", "/settings")).toBe(true);
    expect(isActive("/settingsx", "/settings")).toBe(false);
    expect(isActive("/", "/settings")).toBe(false);
  });
});
