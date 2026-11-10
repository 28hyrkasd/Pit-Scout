import { describe, expect, it } from "vitest";
import {
  DISMISS_FOR_MS,
  DISMISS_KEY,
  decideOffer,
  isDismissed,
  isIosDevice,
  isStandalone,
  rememberDismissed,
} from "./install";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("isIosDevice", () => {
  it("recognises iPhone and iPad (including iPadOS posing as a Mac)", () => {
    expect(isIosDevice({ userAgent: IPHONE })).toBe(true);
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });
  it("is false for Android and for a real Mac", () => {
    expect(isIosDevice({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true for iOS home-screen apps and for display-mode: standalone", () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({ matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }) })).toBe(true);
  });
  it("is false in a normal browser tab", () => {
    expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: false } })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe("dismissal", () => {
  it("hides the offer for two weeks, then lets it come back", () => {
    const store = memoryStore();
    expect(isDismissed(store, 1000)).toBe(false);
    rememberDismissed(store, 1000);
    expect(store.getItem(DISMISS_KEY)).toBe("1000");
    expect(isDismissed(store, 1000 + DISMISS_FOR_MS - 1)).toBe(true);
    expect(isDismissed(store, 1000 + DISMISS_FOR_MS)).toBe(false);
  });
  it("never throws when storage is missing, broken or holds junk", () => {
    expect(isDismissed(null, 1)).toBe(false);
    expect(isDismissed({ getItem: () => "abc", setItem: () => undefined }, 1)).toBe(false);
    expect(() => rememberDismissed({ getItem: () => null, setItem: () => { throw new Error("full"); } }, 1)).not.toThrow();
  });
});

describe("decideOffer", () => {
  const base = { standalone: false, dismissed: false, ios: false, hasNativePrompt: false };
  it("offers the native prompt when the browser handed us one", () => {
    expect(decideOffer({ ...base, hasNativePrompt: true })).toEqual({ kind: "native" });
  });
  it("shows manual steps on iOS, where there is no prompt", () => {
    expect(decideOffer({ ...base, ios: true })).toEqual({ kind: "ios" });
  });
  it("offers nothing when installed, dismissed, or when the browser cannot install", () => {
    expect(decideOffer({ ...base, hasNativePrompt: true, standalone: true })).toEqual({ kind: "none" });
    expect(decideOffer({ ...base, ios: true, dismissed: true })).toEqual({ kind: "none" });
    expect(decideOffer(base)).toEqual({ kind: "none" });
  });
});
