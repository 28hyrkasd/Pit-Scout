import { describe, expect, it } from "vitest";
import { hasUnsavedChanges, isLeavingClick, registerUnsavedChanges, type ClickInfo } from "./unsaved-guard";

const HERE = "https://pit.example.com/teams/254/edit";

function click(overrides: Partial<ClickInfo>): ClickInfo {
  return {
    href: "https://pit.example.com/",
    target: null,
    download: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  };
}

describe("isLeavingClick", () => {
  it("a plain click on another page of the app is leaving", () => {
    expect(isLeavingClick(click({}), HERE)).toBe(true);
    expect(
      isLeavingClick(click({ href: "https://pit.example.com/settings" }), HERE),
    ).toBe(true);
    expect(isLeavingClick(click({ target: "_self" }), HERE)).toBe(true);
  });

  it("clicks that are not on a link are not leaving", () => {
    expect(isLeavingClick(click({ href: null }), HERE)).toBe(false);
  });

  it("opening in a new tab or window is not leaving", () => {
    expect(isLeavingClick(click({ ctrlKey: true }), HERE)).toBe(false);
    expect(isLeavingClick(click({ metaKey: true }), HERE)).toBe(false);
    expect(isLeavingClick(click({ shiftKey: true }), HERE)).toBe(false);
    expect(isLeavingClick(click({ button: 1 }), HERE)).toBe(false);
    expect(isLeavingClick(click({ target: "_blank" }), HERE)).toBe(false);
  });

  it("downloads and already-handled clicks are not leaving", () => {
    expect(isLeavingClick(click({ download: true }), HERE)).toBe(false);
    expect(isLeavingClick(click({ defaultPrevented: true }), HERE)).toBe(false);
  });

  it("the same page and in-page hash links are not leaving", () => {
    expect(isLeavingClick(click({ href: HERE }), HERE)).toBe(false);
    expect(isLeavingClick(click({ href: `${HERE}#photos` }), HERE)).toBe(false);
  });

  it("a different query string IS a different page", () => {
    expect(isLeavingClick(click({ href: `${HERE}?x=1` }), HERE)).toBe(true);
  });

  it("other origins are left to the browser's beforeunload", () => {
    expect(isLeavingClick(click({ href: "https://example.org/" }), HERE)).toBe(
      false,
    );
  });

  it("does not throw on a malformed url", () => {
    expect(isLeavingClick(click({ href: "http://[bad" }), HERE)).toBe(false);
  });
});

describe("unsaved changes registry", () => {
  it("counts dirty forms and releases each registration once", () => {
    expect(hasUnsavedChanges()).toBe(false);
    const a = registerUnsavedChanges();
    const b = registerUnsavedChanges();
    expect(hasUnsavedChanges()).toBe(true);
    a();
    a(); // double release must not under-count
    expect(hasUnsavedChanges()).toBe(true);
    b();
    expect(hasUnsavedChanges()).toBe(false);
  });
});
