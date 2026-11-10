import { describe, expect, it } from "vitest";
import type { AppEpa, AppTeam } from "@/lib/external/schemas";
import { mergeTeamsWithEpa } from "./merge";

const team = (teamNumber: number, extra: Partial<AppTeam> = {}): AppTeam => ({
  teamNumber,
  name: `Team ${teamNumber}`,
  city: null,
  stateProv: null,
  country: null,
  rank: null,
  record: null,
  ...extra,
});

const epa = (teamNumber: number, value: number | null, epaRank: number | null): AppEpa => ({
  teamNumber,
  epa: value,
  epaRank,
});

describe("mergeTeamsWithEpa", () => {
  it("attaches EPA and EPA rank by team number, keeping TBA fields", () => {
    const merged = mergeTeamsWithEpa(
      [team(254, { rank: 3, name: "Cheesy Poofs" }), team(1678)],
      [epa(1678, 49.2, 1), epa(254, 40.1, 2)],
    );
    expect(merged).toEqual([
      expect.objectContaining({ teamNumber: 254, name: "Cheesy Poofs", rank: 3, epa: 40.1, epaRank: 2 }),
      expect.objectContaining({ teamNumber: 1678, epa: 49.2, epaRank: 1 }),
    ]);
  });

  it("never drops a TBA team that Statbotics does not know", () => {
    const merged = mergeTeamsWithEpa([team(254), team(9999)], [epa(254, 40, 1)]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ teamNumber: 9999, epa: null, epaRank: null });
  });

  it("ignores Statbotics teams that are not in the TBA list", () => {
    const merged = mergeTeamsWithEpa([team(254)], [epa(254, 40, 2), epa(111, 55, 1)]);
    expect(merged.map((t) => t.teamNumber)).toEqual([254]);
  });

  it("works when Statbotics failed or has nothing yet (undefined / null / empty)", () => {
    for (const none of [undefined, null, []]) {
      const merged = mergeTeamsWithEpa([team(254), team(1678)], none);
      expect(merged).toHaveLength(2);
      expect(merged.every((t) => t.epa === null && t.epaRank === null)).toBe(true);
    }
  });

  it("preserves a null EPA from Statbotics for a team it lists", () => {
    const merged = mergeTeamsWithEpa([team(254)], [epa(254, null, null)]);
    expect(merged[0]).toMatchObject({ epa: null, epaRank: null });
  });

  it("keeps a valid EPA of exactly 0 (not treated as missing)", () => {
    const merged = mergeTeamsWithEpa([team(254)], [epa(254, 0, 5)]);
    expect(merged[0].epa).toBe(0);
  });

  it("returns an empty list for an empty team list", () => {
    expect(mergeTeamsWithEpa([], [epa(254, 40, 1)])).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const teams = [team(254)];
    const snapshot = structuredClone(teams);
    mergeTeamsWithEpa(teams, [epa(254, 40, 1)]);
    expect(teams).toEqual(snapshot);
  });
});
