import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOUT_NAME_STATE,
  loadScoutName,
  parseScoutName,
  saveScoutName,
  SCOUT_NAME_STORAGE_KEY,
  serializeScoutName,
  type StorageLike,
} from "./scout-name";

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("scout name persistence", () => {
  it("is 'not asked yet' on first launch", () => {
    expect(loadScoutName(memoryStorage())).toEqual({
      asked: false,
      name: null,
    });
  });

  it("saves a name and loads it back after a 'restart' (a fresh read of the same storage)", () => {
    const storage = memoryStorage();
    saveScoutName(storage, "  Dana  Lee ");
    expect(loadScoutName(storage)).toEqual({ asked: true, name: "Dana Lee" });
  });

  it("remembers that the scout skipped, so the prompt is not shown again", () => {
    const storage = memoryStorage();
    saveScoutName(storage, "   ");
    expect(loadScoutName(storage)).toEqual({ asked: true, name: null });
  });

  it("lets the name be changed or cleared later", () => {
    const storage = memoryStorage();
    saveScoutName(storage, "Dana");
    saveScoutName(storage, "Sam");
    expect(loadScoutName(storage).name).toBe("Sam");
    saveScoutName(storage, null);
    expect(loadScoutName(storage)).toEqual({ asked: true, name: null });
  });

  it.each([
    ["garbage", "{not json"],
    ["wrong version", JSON.stringify({ version: 2, asked: true, name: "X" })],
    ["wrong types", JSON.stringify({ version: 1, asked: "yes", name: 5 })],
    ["empty", ""],
    ["array", "[]"],
  ])("falls back to the default for %s", (_label, raw) => {
    expect(parseScoutName(raw)).toEqual(DEFAULT_SCOUT_NAME_STATE);
    expect(
      loadScoutName(memoryStorage({ [SCOUT_NAME_STORAGE_KEY]: raw })),
    ).toEqual(DEFAULT_SCOUT_NAME_STATE);
  });

  it("re-normalizes a hand-edited name on load", () => {
    const raw = JSON.stringify({
      version: 1,
      asked: true,
      name: "  Hand   Edited  ",
    });
    expect(parseScoutName(raw)).toEqual({ asked: true, name: "Hand Edited" });
  });

  it("serialize/parse round-trips", () => {
    const state = { asked: true, name: "Dana" };
    expect(parseScoutName(serializeScoutName(state))).toEqual(state);
  });

  it("does not throw when storage is blocked (Safari private mode, quota)", () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(loadScoutName(blocked)).toEqual(DEFAULT_SCOUT_NAME_STATE);
    expect(saveScoutName(blocked, "Dana")).toBeNull();
  });
});
