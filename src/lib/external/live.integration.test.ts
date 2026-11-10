import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * LIVE integration test against the real TBA and Statbotics APIs.
 *
 * Opt-in: it only runs with `LIVE=1 npx vitest run src/lib/external/live`,
 * because it needs network access and the TBA key from .env.local, and it must
 * not run in normal `npm test`.
 */
const live = process.env.LIVE === "1";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
  );
  return { getServerEnv: () => ({ TBA_API_KEY: env.TBA_API_KEY }) };
});
// next.revalidate is a Next-only fetch option; plain fetch ignores it, which is fine here.

describe.skipIf(!live)("live TBA + Statbotics", () => {
  it("lists events for a year and filters by query", async () => {
    const { getEventsForYear } = await import("./tba");
    const { searchEvents } = await import("./event-search");
    const result = await getEventsForYear(2024);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(100);
    const hits = searchEvents(result.data, "silicon valley");
    expect(hits.map((e) => e.key)).toContain("2024casj");
    // sorted by start date
    const dates = result.data.map((e) => e.startDate ?? "");
    expect([...dates].sort()).toEqual(dates);
  });

  it("returns teams with rank merged in for a finished event", async () => {
    const { getEventTeams } = await import("./tba");
    const result = await getEventTeams("2024casj");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(42);
    const t1678 = result.data.find((t) => t.teamNumber === 1678);
    expect(t1678?.name).toMatch(/citrus/i);
    expect(t1678?.rank).toBe(2);
    expect(t1678?.record).toEqual({ wins: 9, losses: 1, ties: 1 });
    // sorted by team number
    const nums = result.data.map((t) => t.teamNumber);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });


  it("returns a team's status at an event, without HTML", async () => {
    const { getTeamEventStatus } = await import("./tba");
    const result = await getTeamEventStatus(1678, "2024casj");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data).not.toBeNull(); // a finished event must have a status
    if (!result.data) return;
    expect(result.data.rank).toBe(2);
    expect(result.data.numTeams).toBe(42);
    expect(result.data.summary ?? "").not.toMatch(/<[a-z]/i);
  });

  it("reports a missing event as a handled failure, not a throw", async () => {
    const { getEventTeams } = await import("./tba");
    const result = await getEventTeams("2024doesnotexist");
    expect(result.ok).toBe(false);
  });

  it("fetches EPA for a whole event in one call and ranks it", async () => {
    const { getEventEpa } = await import("./statbotics");
    const result = await getEventEpa("2024casj");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(42);
    const top = result.data.find((t) => t.teamNumber === 1678);
    expect(top?.epaRank).toBe(1); // 49.22, highest at the event
    expect(top?.epa).toBeCloseTo(49.22, 1);
    const ranks = result.data.map((t) => t.epaRank).filter((r): r is number => r !== null);
    expect(Math.min(...ranks)).toBe(1);
  });

  it("treats an event with no EPA yet as success with an empty list", async () => {
    const { getEventEpa } = await import("./statbotics");
    const result = await getEventEpa("2026casj");
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.isArray(result.data)).toBe(true);
  });
});
