import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ TBA_API_KEY: "test-key" }),
}));

// vi.mock calls are hoisted above imports and plain consts, so the mock fn must
// be created with vi.hoisted to exist when the factory runs.
const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock("./http", () => ({ getJson }));

import { getEventTeams, getTeamEventStatus } from "./tba";

const teams = [
  { key: "frc1678", team_number: 1678, nickname: "Citrus Circuits", city: "Davis", state_prov: "California", country: "USA" },
  { key: "frc254", team_number: 254, nickname: "The Cheesy Poofs", city: "San Jose", state_prov: "California", country: "USA" },
  { key: "frc8546", team_number: 8546, nickname: "\\n", city: null, state_prov: null, country: null },
  { key: "frc9999", team_number: 9999, nickname: "   ", city: null, state_prov: null, country: null },
];

/** Route getJson by URL so each upstream call can succeed or fail independently. */
function mockUpstream(handlers: { teams?: unknown; rankings?: unknown; status?: unknown }) {
  getJson.mockImplementation(async (url: string) => {
    if (url.includes("/teams/simple")) return handlers.teams;
    if (url.includes("/rankings")) return handlers.rankings;
    if (url.includes("/status")) return handlers.status;
    throw new Error(`unexpected url ${url}`);
  });
}

// Use a block body: a value returned from beforeEach is treated as a cleanup
// function. mockReset() returns the mock itself, so an expression-bodied arrow
// would make vitest call getJson() with no arguments after every test.
function resetMocks() {
  getJson.mockReset();
}

describe("getEventTeams", () => {
  beforeEach(resetMocks);

  it("merges rank and record into teams and sorts by team number", async () => {
    mockUpstream({
      teams: { ok: true, data: teams },
      rankings: {
        ok: true,
        data: {
          rankings: [
            { team_key: "frc1678", rank: 2, record: { wins: 9, losses: 1, ties: 1 } },
            { team_key: "frc254", rank: 7, record: { wins: 6, losses: 4, ties: 1 } },
          ],
        },
      },
    });
    const result = await getEventTeams("2026casj");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((t) => t.teamNumber)).toEqual([254, 1678, 8546, 9999]);
    expect(result.data[0]).toMatchObject({ teamNumber: 254, rank: 7, record: { wins: 6, losses: 4, ties: 1 } });
    expect(result.data[1]).toMatchObject({ teamNumber: 1678, rank: 2 });
    // unranked team
    expect(result.data[2]).toMatchObject({ teamNumber: 8546, rank: null, record: null });
  });

  it("still returns every team with rank null when rankings are null (event not started)", async () => {
    mockUpstream({ teams: { ok: true, data: teams }, rankings: { ok: true, data: null } });
    const result = await getEventTeams("2026casj");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
    expect(result.data.every((t) => t.rank === null && t.record === null)).toBe(true);
  });

  it("still returns every team when the rankings call FAILS", async () => {
    mockUpstream({
      teams: { ok: true, data: teams },
      rankings: { ok: false, error: "The data source timed out." },
    });
    const result = await getEventTeams("2026casj");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
    expect(result.data.every((t) => t.rank === null)).toBe(true);
  });

  it("returns an empty list (success) when the event has no teams yet", async () => {
    mockUpstream({ teams: { ok: true, data: [] }, rankings: { ok: true, data: null } });
    const result = await getEventTeams("2026casj");
    expect(result).toEqual({ ok: true, data: [] });
  });

  it("FAILS when the team list itself fails (teams are the essential data)", async () => {
    mockUpstream({
      teams: { ok: false, status: 404, error: "Not found." },
      rankings: { ok: true, data: null },
    });
    const result = await getEventTeams("2026nope");
    expect(result).toEqual({ ok: false, status: 404, error: "Not found." });
  });

  it("cleans junk nicknames to 'Team N'", async () => {
    mockUpstream({ teams: { ok: true, data: teams }, rankings: { ok: true, data: null } });
    const result = await getEventTeams("2026casj");
    if (!result.ok) throw new Error("expected ok");
    const byNumber = Object.fromEntries(result.data.map((t) => [t.teamNumber, t.name]));
    expect(byNumber[8546]).toBe("Team 8546"); // nickname was a literal "\n"
    expect(byNumber[9999]).toBe("Team 9999"); // whitespace only
    expect(byNumber[1678]).toBe("Citrus Circuits");
  });

  it("sends the TBA key as a header, never in the URL", async () => {
    mockUpstream({ teams: { ok: true, data: [] }, rankings: { ok: true, data: null } });
    await getEventTeams("2026casj");
    for (const [url, , options] of getJson.mock.calls) {
      expect(String(url)).not.toContain("test-key");
      expect((options as { headers: Record<string, string> }).headers["X-TBA-Auth-Key"]).toBe("test-key");
    }
  });
});

describe("getTeamEventStatus", () => {
  beforeEach(resetMocks);

  it("returns null data (success) when TBA has no status for the team", async () => {
    mockUpstream({ status: { ok: true, data: null } });
    expect(await getTeamEventStatus(254, "2026casj")).toEqual({ ok: true, data: null });
  });

  it("strips HTML from the status summary and keeps rank/record/pit", async () => {
    mockUpstream({
      status: {
        ok: true,
        data: {
          qual: { num_teams: 42, ranking: { rank: 3, record: { wins: 5, losses: 2, ties: 0 }, matches_played: 7 } },
          overall_status_str: "Team <b>254</b> is <b>5-2-0</b> &amp; ranked <b>3rd</b>",
          pit_location: "B12",
        },
      },
    });
    const result = await getTeamEventStatus(254, "2026casj");
    if (!result.ok || !result.data) throw new Error("expected data");
    expect(result.data.summary).toBe("Team 254 is 5-2-0 & ranked 3rd");
    expect(result.data).toMatchObject({
      rank: 3,
      numTeams: 42,
      record: { wins: 5, losses: 2, ties: 0 },
      matchesPlayed: 7,
      pitLocation: "B12",
    });
  });

  it("tolerates a status with no qual ranking at all", async () => {
    mockUpstream({ status: { ok: true, data: { qual: null, overall_status_str: null, pit_location: null } } });
    const result = await getTeamEventStatus(254, "2026casj");
    if (!result.ok || !result.data) throw new Error("expected data");
    expect(result.data).toMatchObject({ rank: null, numTeams: null, record: null, summary: null, pitLocation: null });
  });

  it("passes upstream failures through", async () => {
    mockUpstream({ status: { ok: false, error: "Rate limited by the data source. Try again shortly.", status: 429 } });
    expect(await getTeamEventStatus(254, "2026casj")).toMatchObject({ ok: false, status: 429 });
  });
});
