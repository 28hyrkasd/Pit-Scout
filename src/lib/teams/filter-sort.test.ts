import { describe, expect, it } from "vitest";
import type { SavedEntry } from "@/lib/entries/rpc";
import { ACTIVE_FIELDS, canClimb, comments, drivetrain, weight } from "@/lib/entries/fixtures";
import type { Answers, FieldDefinition, NumberField } from "@/lib/fields/types";
import {
  ANY_RED,
  DEFAULT_OPTIONS,
  applyListOptions,
  buildTeamRows,
  defaultDirection,
  directionLabel,
  fieldSortKey,
  matchesQuery,
  normalizeText,
  sortFieldsForDisplay,
  sortKeyFieldId,
  type ListOptions,
  type TeamRow,
} from "./filter-sort";
import type { EventTeam } from "./merge";

function team(teamNumber: number, extra: Partial<EventTeam> = {}): EventTeam {
  return {
    teamNumber,
    name: `Bot ${teamNumber}`,
    city: null,
    stateProv: null,
    country: null,
    rank: null,
    record: null,
    epa: null,
    epaRank: null,
    ...extra,
  };
}

function entry(
  teamNumber: number,
  answers: Answers = {},
  extra: Partial<SavedEntry> = {},
): SavedEntry {
  return {
    id: `id-${teamNumber}`,
    eventKey: "2026casj",
    teamNumber,
    answers,
    rating: null,
    notes: null,
    scoutedBy: null,
    createdAt: "2026-11-09T20:00:00.000Z",
    updatedAt: "2026-11-09T20:00:00.000Z",
    ...extra,
  };
}

const FIELDS = ACTIVE_FIELDS;
const opts = (o: Partial<ListOptions> = {}): ListOptions => ({ ...DEFAULT_OPTIONS, ...o });
const numbers = (rows: TeamRow[]) => rows.map((r) => r.teamNumber);

function run(teams: EventTeam[], entries: SavedEntry[], o: Partial<ListOptions> = {}, fields: FieldDefinition[] = FIELDS) {
  return numbers(applyListOptions(buildTeamRows(teams, entries, fields), fields, opts(o)));
}

describe("normalizeText / matchesQuery", () => {
  it("normalizes case, accents and whitespace", () => {
    expect(normalizeText("  Café   ROBOTICS ")).toBe("cafe robotics");
  });

  it("an empty or blank query matches everything", () => {
    expect(matchesQuery(team(254), "")).toBe(true);
    expect(matchesQuery(team(254), "   ")).toBe(true);
  });

  it("matches a team number by prefix, not by containment", () => {
    // Names are digit-free here so only the number can match.
    const named = (n: number) => team(n, { name: "Robo" });
    expect(matchesQuery(named(254), "25")).toBe(true);
    expect(matchesQuery(named(254), "254")).toBe(true);
    expect(matchesQuery(named(1254), "25")).toBe(false);
    expect(matchesQuery(named(254), "2540")).toBe(false);
  });

  it("accepts #254 and frc254 and trims the query", () => {
    expect(matchesQuery(team(254), " #254 ")).toBe(true);
    expect(matchesQuery(team(254), "FRC254")).toBe(true);
    expect(matchesQuery(team(255), "frc254")).toBe(false);
  });

  it("matches names case-insensitively, anywhere in the name", () => {
    const t = team(1, { name: "The Cheesy Poofs" });
    expect(matchesQuery(t, "cheesy")).toBe(true);
    expect(matchesQuery(t, "POOFS")).toBe(true);
    expect(matchesQuery(t, "  chee ")).toBe(true);
    expect(matchesQuery(t, "pizza")).toBe(false);
  });

  it("is accent-insensitive in both directions", () => {
    expect(matchesQuery(team(1, { name: "Café Bots" }), "cafe")).toBe(true);
    expect(matchesQuery(team(1, { name: "Cafe Bots" }), "café")).toBe(true);
  });

  it("does not treat regex characters as patterns", () => {
    expect(matchesQuery(team(1, { name: "A.B" }), ".")).toBe(true);
    expect(matchesQuery(team(1, { name: "AB" }), ".")).toBe(false);
    expect(matchesQuery(team(1, { name: "AB" }), "(")).toBe(false);
  });
});

describe("sortFieldsForDisplay", () => {
  it("orders by section, then sort order, then name", () => {
    const ordered = sortFieldsForDisplay(FIELDS).map((f) => f.id);
    // specs: weight(0), drivetrain(1); auto: comments; endgame: canClimb
    expect(ordered).toEqual([weight.id, drivetrain.id, comments.id, canClimb.id]);
  });

  it("does not mutate its input", () => {
    const copy = [...FIELDS];
    sortFieldsForDisplay(FIELDS);
    expect(FIELDS).toEqual(copy);
  });
});

describe("buildTeamRows", () => {
  it("makes an unscouted row for a team with no entry", () => {
    const [row] = buildTeamRows([team(254)], [], FIELDS);
    expect(row.scouted).toBe(false);
    expect(row.entry).toBeNull();
    expect(row.ratings).toEqual(["none", "none", "none", "none"]);
    expect(row.counts).toEqual({ good: 0, neutral: 0, bad: 0, none: 4 });
  });

  it("rates each answer against the current field definition", () => {
    const [row] = buildTeamRows(
      [team(254)],
      [entry(254, { [weight.id]: 130, [drivetrain.id]: "swerve", [canClimb.id]: true, [comments.id]: "fast" })],
      FIELDS,
    );
    expect(row.scouted).toBe(true);
    expect(row.ratings).toEqual(["bad", "good", "neutral", "good"]);
    expect(row.counts).toEqual({ good: 2, neutral: 1, bad: 1, none: 0 });
  });

  it("ignores answers for fields that were removed", () => {
    const [row] = buildTeamRows([team(1)], [entry(1, { "gone-field": 5, [canClimb.id]: false })], FIELDS);
    expect(row.ratings).toEqual(["none", "none", "none", "bad"]);
  });

  it("rates an answer for a removed dropdown option as none", () => {
    const [row] = buildTeamRows([team(1)], [entry(1, { [drivetrain.id]: "mecanum" })], FIELDS);
    expect(row.ratings[1]).toBe("none");
  });

  it("collapses duplicate team numbers, keeping the first", () => {
    const rows = buildTeamRows([team(5, { name: "First" }), team(5, { name: "Second" })], [], FIELDS);
    expect(rows).toHaveLength(1);
    expect(rows[0].team.name).toBe("First");
  });

  it("collapses duplicate entries, keeping the most recently updated", () => {
    const older = entry(5, { [canClimb.id]: true }, { id: "old", updatedAt: "2026-11-09T20:00:00.000Z" });
    const newer = entry(5, { [canClimb.id]: false }, { id: "new", updatedAt: "2026-11-09T21:00:00.000Z" });
    expect(buildTeamRows([team(5)], [newer, older], FIELDS)[0].entry?.id).toBe("new");
    expect(buildTeamRows([team(5)], [older, newer], FIELDS)[0].entry?.id).toBe("new");
  });

  it("keeps a row for an entry whose team is not on the team list", () => {
    const rows = buildTeamRows([team(1)], [entry(9999, { [canClimb.id]: true })], FIELDS);
    const orphan = rows.find((r) => r.teamNumber === 9999);
    expect(orphan).toMatchObject({ inEventList: false, scouted: true });
    expect(orphan?.team.name).toBe("Team 9999");
    expect(rows.find((r) => r.teamNumber === 1)?.inEventList).toBe(true);
  });

  it("works with no teams and no entries", () => {
    expect(buildTeamRows([], [], FIELDS)).toEqual([]);
  });
});

describe("sorting", () => {
  const teams = [team(300), team(100), team(200)];

  it("sorts by team number ascending and descending", () => {
    expect(run(teams, [], { sort: "teamNumber", direction: "asc" })).toEqual([100, 200, 300]);
    expect(run(teams, [], { sort: "teamNumber", direction: "desc" })).toEqual([300, 200, 100]);
  });

  it("puts teams with no value LAST when ascending, and LAST when descending", () => {
    const withRank = [team(1, { rank: null }), team(2, { rank: 5 }), team(3, { rank: 1 }), team(4, { rank: null })];
    expect(run(withRank, [], { sort: "rank", direction: "asc" })).toEqual([3, 2, 1, 4]);
    expect(run(withRank, [], { sort: "rank", direction: "desc" })).toEqual([2, 3, 1, 4]);
  });

  it("puts teams with no EPA last in both directions", () => {
    const withEpa = [team(1, { epa: null }), team(2, { epa: 30.5 }), team(3, { epa: 55 })];
    expect(run(withEpa, [], { sort: "epa", direction: "desc" })).toEqual([3, 2, 1]);
    expect(run(withEpa, [], { sort: "epa", direction: "asc" })).toEqual([2, 3, 1]);
  });

  it("treats NaN / Infinity as missing", () => {
    const odd = [team(1, { epa: Number.NaN }), team(2, { epa: 10 }), team(3, { epa: Number.POSITIVE_INFINITY })];
    expect(run(odd, [], { sort: "epa", direction: "desc" })).toEqual([2, 1, 3]);
  });

  it("sorts by overall rating with unscouted and unrated teams last", () => {
    const entries = [entry(1, {}, { rating: 3 }), entry(2, {}, { rating: 5 }), entry(3, {}, { rating: null })];
    const all = [team(1), team(2), team(3), team(4)];
    expect(run(all, entries, { sort: "rating", direction: "desc" })).toEqual([2, 1, 3, 4]);
    expect(run(all, entries, { sort: "rating", direction: "asc" })).toEqual([1, 2, 3, 4]);
  });

  it("breaks ties by team number ascending, even when sorting descending", () => {
    const tied = [team(30, { rank: 2 }), team(10, { rank: 2 }), team(20, { rank: 2 })];
    expect(run(tied, [], { sort: "rank", direction: "asc" })).toEqual([10, 20, 30]);
    expect(run(tied, [], { sort: "rank", direction: "desc" })).toEqual([10, 20, 30]);
  });

  it("orders several teams with no value by team number", () => {
    const missing = [team(9), team(7), team(8, { rank: 1 })];
    expect(run(missing, [], { sort: "rank", direction: "desc" })).toEqual([8, 7, 9]);
  });

  describe("by a single field", () => {
    const entries = [
      entry(1, { [canClimb.id]: true }),
      entry(2, { [canClimb.id]: false }),
      entry(3, {}), // scouted, but did not answer this field
    ];
    const all = [team(1), team(2), team(3), team(4)]; // 4 is unscouted

    it("sorts best first (descending) with no-data and unscouted teams last", () => {
      expect(run(all, entries, { sort: fieldSortKey(canClimb.id), direction: "desc" })).toEqual([1, 2, 3, 4]);
    });

    it("sorts worst first (ascending) and still keeps no-data teams last", () => {
      expect(run(all, entries, { sort: fieldSortKey(canClimb.id), direction: "asc" })).toEqual([2, 1, 3, 4]);
    });

    it("orders teams within one rating by the number, honouring higherIsBetter", () => {
      // weight: lower is better, good <= 100, bad >= 120
      const w = [entry(1, { [weight.id]: 90 }), entry(2, { [weight.id]: 70 }), entry(3, { [weight.id]: 110 })];
      const t = [team(1), team(2), team(3)];
      // best first: both good ones (70 beats 90), then the okay one
      expect(run(t, w, { sort: fieldSortKey(weight.id), direction: "desc" })).toEqual([2, 1, 3]);
      expect(run(t, w, { sort: fieldSortKey(weight.id), direction: "asc" })).toEqual([3, 1, 2]);

      const higher: NumberField = { ...weight, higherIsBetter: true, goodThreshold: 50, badThreshold: 10 };
      const h = [entry(1, { [weight.id]: 60 }), entry(2, { [weight.id]: 90 })];
      expect(run([team(1), team(2)], h, { sort: fieldSortKey(weight.id), direction: "desc" }, [higher])).toEqual([2, 1]);
    });

    it("falls back to team-number order when the sort field no longer exists", () => {
      expect(run([team(30), team(10)], [], { sort: fieldSortKey("deleted"), direction: "desc" })).toEqual([10, 30]);
    });
  });

  it("does not mutate the input rows", () => {
    const rows = buildTeamRows(teams, [], FIELDS);
    const before = numbers(rows);
    applyListOptions(rows, FIELDS, opts({ sort: "teamNumber", direction: "asc" }));
    expect(numbers(rows)).toEqual(before);
  });
});

describe("filters", () => {
  const entries = [
    entry(1, { [canClimb.id]: false, [weight.id]: 90 }), // red climb
    entry(2, { [canClimb.id]: true, [weight.id]: 130 }), // red weight
    entry(3, { [canClimb.id]: true, [weight.id]: 90 }), // no reds
  ];
  const all = [team(1), team(2), team(3), team(4)]; // 4 unscouted

  it("shows only teams with a red in the chosen field", () => {
    expect(run(all, entries, { redFilter: canClimb.id })).toEqual([1]);
    expect(run(all, entries, { redFilter: weight.id })).toEqual([2]);
  });

  it("'any red' shows teams with a red in any field", () => {
    expect(run(all, entries, { redFilter: ANY_RED })).toEqual([1, 2]);
  });

  it("never counts an unscouted team as having a red", () => {
    expect(run(all, entries, { redFilter: canClimb.id })).not.toContain(4);
    expect(run(all, entries, { redFilter: ANY_RED })).not.toContain(4);
  });

  it("an unknown red-filter field does not hide anyone", () => {
    expect(run(all, entries, { redFilter: "deleted" })).toEqual([1, 2, 3, 4]);
  });

  it("'unscouted only' keeps only teams with no entry", () => {
    expect(run(all, entries, { unscoutedOnly: true })).toEqual([4]);
    expect(run(all, entries, { unscoutedOnly: false })).toEqual([1, 2, 3, 4]);
  });

  it("combines search, filters and sorting", () => {
    expect(run(all, entries, { redFilter: ANY_RED, query: "bot 2" })).toEqual([2]);
    expect(run(all, entries, { redFilter: ANY_RED, unscoutedOnly: true })).toEqual([]);
    expect(run(all, entries, { query: "nobody" })).toEqual([]);
    expect(run(all, entries, { redFilter: ANY_RED, sort: "teamNumber", direction: "desc" })).toEqual([2, 1]);
  });
});

describe("sort helpers", () => {
  it("round-trips a field sort key", () => {
    expect(sortKeyFieldId(fieldSortKey("abc"))).toBe("abc");
    expect(sortKeyFieldId("rank")).toBeNull();
  });

  it("picks a sensible default direction per key", () => {
    expect(defaultDirection("teamNumber")).toBe("asc");
    expect(defaultDirection("rank")).toBe("asc");
    expect(defaultDirection("epa")).toBe("desc");
    expect(defaultDirection("rating")).toBe("desc");
    expect(defaultDirection(fieldSortKey("x"))).toBe("desc");
  });

  it("describes the direction in words", () => {
    expect(directionLabel("rank", "asc")).toBe("Best rank first");
    expect(directionLabel("epa", "desc")).toBe("Highest first");
    expect(directionLabel(fieldSortKey("x"), "asc")).toBe("Worst first");
    expect(directionLabel("teamNumber", "desc")).toBe("High to low");
  });
});

describe("performance sanity", () => {
  it("handles 2000 fields x 100 teams quickly", () => {
    const fields: FieldDefinition[] = [];
    for (let i = 0; i < 2000; i++) {
      const base = { id: `field-${i}`, name: `Field ${i}`, section: "other" as const, sortOrder: i, archived: false };
      if (i % 4 === 0) {
        fields.push({ ...base, type: "number", higherIsBetter: true, goodThreshold: 10, badThreshold: 2 });
      } else if (i % 4 === 1) {
        fields.push({ ...base, type: "yes_no", goodAnswer: true });
      } else if (i % 4 === 2) {
        fields.push({
          ...base,
          type: "dropdown",
          options: [
            { value: "a", label: "A", tone: "good" },
            { value: "b", label: "B", tone: "bad" },
          ],
        });
      } else {
        fields.push({ ...base, type: "text" });
      }
    }
    const teams: EventTeam[] = [];
    const entries: SavedEntry[] = [];
    for (let t = 1; t <= 100; t++) {
      teams.push(team(t, { rank: t % 7 === 0 ? null : t, epa: t * 1.5 }));
      if (t % 5 === 0) continue; // some unscouted
      const answers: Answers = {};
      fields.forEach((f, i) => {
        if (f.type === "number") answers[f.id] = (t + i) % 15;
        else if (f.type === "yes_no") answers[f.id] = (t + i) % 3 === 0;
        else if (f.type === "dropdown") answers[f.id] = (t + i) % 2 === 0 ? "a" : "b";
        else answers[f.id] = "text";
      });
      entries.push(entry(t, answers, { rating: (t % 5) + 1 }));
    }

    const start = performance.now();
    const rows = buildTeamRows(teams, entries, fields);
    const result = applyListOptions(rows, fields, opts({ sort: fieldSortKey("field-1999"), redFilter: "field-1" }));
    const elapsed = performance.now() - start;

    expect(rows).toHaveLength(100);
    expect(rows[0].ratings).toHaveLength(2000);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(100);
    expect(elapsed).toBeLessThan(1500); // typically tens of ms; generous so CI never flakes
  });
});
