import { describe, expect, it } from "vitest";
import { parseFieldRow, parseFieldRows, sortFields, type FieldRow } from "./parse";

const row = (over: Partial<FieldRow> = {}): FieldRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Weight",
  section: "specs",
  type: "number",
  options: null,
  higher_is_better: false,
  good_threshold: 110,
  bad_threshold: 125,
  good_answer: null,
  sort_order: 10,
  archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("parseFieldRow", () => {
  it("parses a number field", () => {
    expect(parseFieldRow(row())).toEqual({
      ok: true,
      field: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Weight",
        section: "specs",
        sortOrder: 10,
        archived: false,
        type: "number",
        higherIsBetter: false,
        goodThreshold: 110,
        badThreshold: 125,
      },
    });
  });

  it("keeps null thresholds as null (not 0)", () => {
    const r = parseFieldRow(row({ good_threshold: null, bad_threshold: null }));
    expect(r.ok && r.field.type === "number" && [r.field.goodThreshold, r.field.badThreshold]).toEqual([null, null]);
  });

  it("keeps a threshold of exactly 0", () => {
    const r = parseFieldRow(row({ good_threshold: 0 }));
    expect(r.ok && r.field.type === "number" && r.field.goodThreshold).toBe(0);
  });

  it("defaults a number field with no direction to higher-is-better", () => {
    const r = parseFieldRow(row({ higher_is_better: null }));
    expect(r.ok && r.field.type === "number" && r.field.higherIsBetter).toBe(true);
  });

  it("parses yes/no with true, false and null good answers", () => {
    for (const good of [true, false, null]) {
      const r = parseFieldRow(row({ type: "yes_no", good_answer: good, higher_is_better: null, good_threshold: null, bad_threshold: null }));
      expect(r.ok && r.field.type === "yes_no" && r.field.goodAnswer).toBe(good);
    }
  });

  it("parses a dropdown with options", () => {
    const options = [
      { value: "swerve", label: "Swerve", tone: "good" },
      { value: "tank", label: "Tank", tone: "neutral" },
    ];
    const r = parseFieldRow(row({ type: "dropdown", options, higher_is_better: null, good_threshold: null, bad_threshold: null }));
    expect(r.ok && r.field.type === "dropdown" && r.field.options).toEqual(options);
  });

  it("parses a text field", () => {
    const r = parseFieldRow(row({ type: "text", higher_is_better: null, good_threshold: null, bad_threshold: null }));
    expect(r.ok && r.field.type).toBe("text");
  });

  describe("rejects corrupt rows without throwing", () => {
    const dropdown = (options: unknown) =>
      row({ type: "dropdown", options: options as never, higher_is_better: null, good_threshold: null, bad_threshold: null });

    it.each([
      ["null options", dropdown(null)],
      ["options not an array", dropdown({ value: "x" })],
      ["empty options array", dropdown([])],
      ["option missing a tone", dropdown([{ value: "a", label: "A" }])],
      ["option with an invalid tone", dropdown([{ value: "a", label: "A", tone: "purple" }])],
      ["option with an empty value", dropdown([{ value: "", label: "A", tone: "good" }])],
      ["duplicate option values", dropdown([{ value: "a", label: "A", tone: "good" }, { value: "a", label: "B", tone: "bad" }])],
      ["unknown type", row({ type: "slider" })],
      ["unknown section", row({ section: "pit-crew" })],
      ["empty name", row({ name: "" })],
    ])("%s", (_label, bad) => {
      const r = parseFieldRow(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.id).toBe(bad.id);
        expect(r.reason.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("parseFieldRows", () => {
  it("returns good fields and reports bad rows instead of failing the whole list", () => {
    const { fields, invalid } = parseFieldRows([
      row({ id: "a", name: "Good one" }),
      row({ id: "b", name: "Broken", type: "dropdown", options: null }),
      row({ id: "c", name: "Another good one", sort_order: 5 }),
    ]);
    expect(fields.map((f) => f.id)).toEqual(["c", "a"]);
    expect(invalid).toEqual([{ id: "b", name: "Broken", reason: expect.any(String) }]);
  });

  it("returns empty results for no rows", () => {
    expect(parseFieldRows([])).toEqual({ fields: [], invalid: [] });
  });
});

describe("sortFields", () => {
  const f = (id: string, section: "specs" | "auto" | "endgame" | "other", sortOrder: number, name = id) => ({ id, section, sortOrder, name });

  it("orders by section, then sort order, then name", () => {
    const sorted = sortFields([
      f("e2", "endgame", 20),
      f("s2", "specs", 20),
      f("a1", "auto", 10),
      f("s1", "specs", 10),
      f("o1", "other", 5),
      f("e1", "endgame", 10),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["s1", "s2", "a1", "e1", "e2", "o1"]);
  });

  it("breaks ties deterministically by name then id", () => {
    const sorted = sortFields([f("2", "specs", 1, "Beta"), f("1", "specs", 1, "Alpha"), f("3", "specs", 1, "Alpha")]);
    expect(sorted.map((x) => x.id)).toEqual(["1", "3", "2"]);
  });

  it("does not mutate its input", () => {
    const input = [f("b", "specs", 2), f("a", "specs", 1)];
    sortFields(input);
    expect(input.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
