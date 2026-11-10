import { describe, expect, it } from "vitest";
import { ANY_RED, DEFAULT_OPTIONS, type ListOptions } from "./filter-sort";
import { parseListPrefs, sanitizeListPrefs, serializeListPrefs } from "./list-prefs";

const CUSTOM: ListOptions = {
  query: "ber",
  sort: "field:abc",
  direction: "asc",
  redFilter: "def",
  unscoutedOnly: true,
};

describe("parseListPrefs", () => {
  it("round-trips valid options", () => {
    expect(parseListPrefs(serializeListPrefs(CUSTOM))).toEqual(CUSTOM);
  });

  it("returns defaults for null, garbage and non-objects", () => {
    expect(parseListPrefs(null)).toEqual(DEFAULT_OPTIONS);
    expect(parseListPrefs("not json")).toEqual(DEFAULT_OPTIONS);
    expect(parseListPrefs("42")).toEqual(DEFAULT_OPTIONS);
    expect(parseListPrefs("null")).toEqual(DEFAULT_OPTIONS);
  });

  it("repairs each bad value independently instead of discarding everything", () => {
    const parsed = parseListPrefs(
      JSON.stringify({ query: "x", sort: "bogus", direction: "sideways", redFilter: 7, unscoutedOnly: "yes" }),
    );
    expect(parsed).toEqual({ ...DEFAULT_OPTIONS, query: "x" });
  });

  it("fills in missing keys with defaults", () => {
    expect(parseListPrefs(JSON.stringify({ unscoutedOnly: true }))).toEqual({ ...DEFAULT_OPTIONS, unscoutedOnly: true });
  });

  it("accepts the built-in sort keys and the any-red filter", () => {
    expect(parseListPrefs(JSON.stringify({ sort: "epa", redFilter: ANY_RED })).sort).toBe("epa");
    expect(parseListPrefs(JSON.stringify({ redFilter: ANY_RED })).redFilter).toBe(ANY_RED);
  });
});

describe("sanitizeListPrefs", () => {
  it("keeps options whose fields still exist", () => {
    expect(sanitizeListPrefs(CUSTOM, new Set(["abc", "def"]))).toBe(CUSTOM);
  });

  it("resets a sort on a removed field (and its direction)", () => {
    const result = sanitizeListPrefs(CUSTOM, new Set(["def"]));
    expect(result.sort).toBe("teamNumber");
    expect(result.direction).toBe("asc");
    expect(result.redFilter).toBe("def");
  });

  it("clears a red filter on a removed field but keeps any-red", () => {
    expect(sanitizeListPrefs(CUSTOM, new Set(["abc"])).redFilter).toBeNull();
    const any = { ...CUSTOM, redFilter: ANY_RED };
    expect(sanitizeListPrefs(any, new Set(["abc"])).redFilter).toBe(ANY_RED);
  });
});
