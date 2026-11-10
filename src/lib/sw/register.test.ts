import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPageCaches, registerServiceWorker } from "./register";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerServiceWorker", () => {
  it("does nothing outside production builds (dev must never register a worker)", async () => {
    // vitest runs with NODE_ENV=test.
    await expect(registerServiceWorker()).resolves.toBeNull();
  });
});

describe("clearPageCaches", () => {
  function stubCaches(names: string[]) {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => names,
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    return deleted;
  }

  it("deletes page and runtime asset caches but keeps the precache", async () => {
    const deleted = stubCaches(["pit-pages-abc", "pit-pages-old", "pit-static-assets", "serwist-precache-v2-https://x/", "other"]);
    await expect(clearPageCaches()).resolves.toBe(3);
    expect(deleted.sort()).toEqual(["pit-pages-abc", "pit-pages-old", "pit-static-assets"]);
  });

  it("is a no-op without the Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearPageCaches()).resolves.toBe(0);
  });
});
