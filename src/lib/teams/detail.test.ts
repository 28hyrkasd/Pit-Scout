import { describe, expect, it } from "vitest";
import { archivedField, canClimb, comments, drivetrain, weight } from "@/lib/entries/fixtures";
import {
  buildDetailSections,
  formatEpa,
  formatRecord,
  formatTeamLocation,
  formatTimestamp,
} from "./detail";

const FIELDS = [weight, drivetrain, comments, canClimb, archivedField];

describe("buildDetailSections", () => {
  it("groups active fields into the entry form's sections, in order", () => {
    const sections = buildDetailSections(FIELDS, {});
    expect(sections.map((s) => s.label)).toEqual(["Specs", "Autonomous", "Endgame"]);
    expect(sections[0].items.map((i) => i.field.id)).toEqual([weight.id, drivetrain.id]);
  });

  it("hides archived fields and omits empty sections", () => {
    const sections = buildDetailSections(FIELDS, { [archivedField.id]: 5 });
    expect(sections.flatMap((s) => s.items).some((i) => i.field.id === archivedField.id)).toBe(false);
    expect(sections.some((s) => s.section === "other")).toBe(false);
  });

  it("rates and formats each answer", () => {
    const [specs, , endgame] = buildDetailSections(FIELDS, {
      [weight.id]: 130,
      [drivetrain.id]: "swerve",
      [canClimb.id]: false,
    });
    expect(specs.items[0]).toMatchObject({ rating: "bad", text: "130", stale: false });
    expect(specs.items[1]).toMatchObject({ rating: "good", text: "Swerve", stale: false });
    expect(endgame.items[0]).toMatchObject({ rating: "bad", text: "No", stale: false });
  });

  it("shows unanswered fields as no data, not stale", () => {
    const [specs] = buildDetailSections(FIELDS, {});
    expect(specs.items[0]).toMatchObject({ rating: "none", text: null, stale: false });
  });

  it("flags an answer for a removed dropdown option as stale", () => {
    const [specs] = buildDetailSections(FIELDS, { [drivetrain.id]: "mecanum" });
    expect(specs.items[1]).toMatchObject({ rating: "none", text: null, stale: true });
  });

  it("ignores answers for fields that no longer exist", () => {
    const sections = buildDetailSections(FIELDS, { "removed-field": 99 });
    expect(sections.flatMap((s) => s.items)).toHaveLength(4);
  });

  it("returns no sections when there are no fields", () => {
    expect(buildDetailSections([], { a: 1 })).toEqual([]);
  });
});

describe("formatters", () => {
  it("formats a timestamp from an ISO string (any zone, mid-year noon is always June 2026)", () => {
    const text = formatTimestamp("2026-06-15T12:00:00.000Z");
    expect(text).toMatch(/Jun 1[456], 2026/);
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatTimestamp("yesterday-ish")).toBeNull();
    expect(formatTimestamp("")).toBeNull();
  });

  it("formats a record, location and EPA", () => {
    expect(formatRecord({ wins: 5, losses: 3, ties: 1 })).toBe("5-3-1");
    expect(formatRecord(null)).toBeNull();
    expect(formatTeamLocation({ city: "San Jose", stateProv: "CA", country: "USA" })).toBe("San Jose, CA, USA");
    expect(formatTeamLocation({ city: null, stateProv: null, country: null })).toBeNull();
    expect(formatEpa(45.234)).toBe("45.2");
    expect(formatEpa(null)).toBe("–");
    expect(formatEpa(Number.NaN)).toBe("–");
  });
});
