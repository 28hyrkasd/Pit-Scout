import { describe, expect, it } from "vitest";
import { signOutWarning } from "./sign-out-guard";

describe("signOutWarning", () => {
  it("does not warn when everything is synced or counts are unknown", () => {
    expect(signOutWarning({ unsynced: 0 }, true)).toBeNull();
    expect(signOutWarning(null, true)).toBeNull();
  });

  it("includes the pending count and says nothing is deleted (persistent store)", () => {
    const w = signOutWarning({ unsynced: 3 }, true);
    expect(w?.title).toContain("3 entries aren't synced");
    expect(w?.body).toMatch(/3 scouting entries/);
    expect(w?.body).toMatch(/won't delete/);
    expect(w?.cancelLabel).toBe("Stay signed in");
  });

  it("uses the singular for one entry", () => {
    const w = signOutWarning({ unsynced: 1 }, true);
    expect(w?.title).toBe("1 entry isn't synced yet");
    expect(w?.body).toContain("1 scouting entry");
  });

  it("warns that data CAN be lost when storage is memory-only", () => {
    const w = signOutWarning({ unsynced: 2 }, false);
    expect(w?.body).toMatch(/may be lost/);
    expect(w?.body).not.toMatch(/won't delete/);
  });
});
