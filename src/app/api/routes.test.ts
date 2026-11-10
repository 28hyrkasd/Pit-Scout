import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const { getCurrentUser, tba, statbotics } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  tba: { getEventsForYear: vi.fn(), getEventTeams: vi.fn(), getTeamEventStatus: vi.fn() },
  statbotics: { getEventEpa: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/external/tba", () => tba);
vi.mock("@/lib/external/statbotics", () => statbotics);

import { GET as getEvents } from "./tba/events/[year]/route";
import { GET as getTeams } from "./tba/event/[eventKey]/teams/route";
import { GET as getTeam } from "./tba/event/[eventKey]/team/[teamNumber]/route";
import { GET as getEpa } from "./statbotics/event/[eventKey]/route";

function resetMocks() {
  for (const fn of [getCurrentUser, ...Object.values(tba), ...Object.values(statbotics)]) fn.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1", email: "scout@example.com" });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
// RouteContext is a generated, route-specific type; the tests only need `params`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (p: Record<string, string>) => params(p) as any;
const req = (path: string) => new NextRequest(`http://localhost${path}`);
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("auth is enforced inside every handler (defense in depth beyond the proxy)", () => {
  beforeEach(resetMocks);

  it.each([
    ["events", () => getEvents(req("/api/tba/events/2026"), ctx({ year: "2026" }))],
    ["teams", () => getTeams(req("/x"), ctx({ eventKey: "2026casj" }))],
    ["team", () => getTeam(req("/x"), ctx({ eventKey: "2026casj", teamNumber: "254" }))],
    ["epa", () => getEpa(req("/x"), ctx({ eventKey: "2026casj" }))],
  ])("%s returns 401 and never calls upstream when signed out", async (_name, call) => {
    getCurrentUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({ ok: false, data: null, error: "Not signed in." });
    for (const fn of [...Object.values(tba), ...Object.values(statbotics)]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("param validation", () => {
  beforeEach(resetMocks);

  it("rejects bad years", async () => {
    for (const year of ["abc", "1800", "3000", "20.5", ""]) {
      const res = await getEvents(req(`/api/tba/events/${year}`), ctx({ year }));
      expect(res.status, `year=${year}`).toBe(400);
    }
    expect(tba.getEventsForYear).not.toHaveBeenCalled();
  });

  it("rejects bad event keys (path traversal / injection shapes)", async () => {
    for (const eventKey of ["", "casj", "2026 casj", "2026CASJ", "2026casj/../x", "2026casj?x=1", "../../etc"]) {
      expect((await getTeams(req("/x"), ctx({ eventKey }))).status, `key=${eventKey}`).toBe(400);
      expect((await getEpa(req("/x"), ctx({ eventKey }))).status, `key=${eventKey}`).toBe(400);
    }
    expect(tba.getEventTeams).not.toHaveBeenCalled();
    expect(statbotics.getEventEpa).not.toHaveBeenCalled();
  });

  it("rejects bad team numbers", async () => {
    for (const teamNumber of ["0", "-1", "abc", "100000", "25.5"]) {
      const res = await getTeam(req("/x"), ctx({ eventKey: "2026casj", teamNumber }));
      expect(res.status, `team=${teamNumber}`).toBe(400);
    }
    expect(tba.getTeamEventStatus).not.toHaveBeenCalled();
  });

  it("rejects an over-long search query", async () => {
    const res = await getEvents(req(`/api/tba/events/2026?q=${"a".repeat(101)}`), ctx({ year: "2026" }));
    expect(res.status).toBe(400);
  });
});

describe("responses", () => {
  beforeEach(resetMocks);

  it("returns the envelope with a private cache header on success", async () => {
    tba.getEventTeams.mockResolvedValue({ ok: true, data: [{ teamNumber: 254 }] });
    const res = await getTeams(req("/x"), ctx({ eventKey: "2026casj" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=120, stale-while-revalidate=600");
    expect(await json(res)).toMatchObject({ ok: true, data: [{ teamNumber: 254 }], error: null });
    expect(typeof (await json(await getTeams(req("/x"), ctx({ eventKey: "2026casj" }))))["fetchedAt"]).toBe("string");
  });

  it("never marks a response as publicly cacheable (it is per-user)", async () => {
    tba.getEventTeams.mockResolvedValue({ ok: true, data: [] });
    const res = await getTeams(req("/x"), ctx({ eventKey: "2026casj" }));
    const header = res.headers.get("cache-control") ?? "";
    expect(header).toContain("private");
    expect(header).not.toMatch(/public|s-maxage/);
  });

  it("degrades an upstream failure to 200 + ok:false, uncached, with the reason", async () => {
    tba.getEventTeams.mockResolvedValue({ ok: false, error: "The data source timed out." });
    const res = await getTeams(req("/x"), ctx({ eventKey: "2026casj" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({ ok: false, data: null, error: "The data source timed out." });
  });

  it("keeps an upstream 404 as a 404 (event does not exist)", async () => {
    tba.getEventTeams.mockResolvedValue({ ok: false, status: 404, error: "Not found." });
    const res = await getTeams(req("/x"), ctx({ eventKey: "2026nope" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("treats an upstream 429/500 as a soft failure (200), not a server error", async () => {
    for (const status of [429, 500, 503]) {
      statbotics.getEventEpa.mockResolvedValue({ ok: false, status, error: "x" });
      expect((await getEpa(req("/x"), ctx({ eventKey: "2026casj" }))).status, `upstream ${status}`).toBe(200);
    }
  });

  it("returns ok:true with an empty list for an event with no EPA yet", async () => {
    statbotics.getEventEpa.mockResolvedValue({ ok: true, data: [] });
    const res = await getEpa(req("/x"), ctx({ eventKey: "2026casj" }));
    expect(await json(res)).toMatchObject({ ok: true, data: [], error: null });
  });

  it("returns null data (ok:true) when a team has no status yet", async () => {
    tba.getTeamEventStatus.mockResolvedValue({ ok: true, data: null });
    const res = await getTeam(req("/x"), ctx({ eventKey: "2026casj", teamNumber: "254" }));
    expect(await json(res)).toMatchObject({ ok: true, data: null, error: null });
  });

  it("passes the parsed year and query through to event search", async () => {
    tba.getEventsForYear.mockResolvedValue({
      ok: true,
      data: [
        { key: "2026casj", name: "Silicon Valley Regional", year: 2026, startDate: null, endDate: null, city: "San Jose", stateProv: "CA", country: "USA" },
        { key: "2026cala", name: "Los Angeles Regional", year: 2026, startDate: null, endDate: null, city: "Los Angeles", stateProv: "CA", country: "USA" },
      ],
    });
    const res = await getEvents(req("/api/tba/events/2026?q=silicon"), ctx({ year: "2026" }));
    expect(tba.getEventsForYear).toHaveBeenCalledWith(2026);
    const body = (await json(res)) as { data: { key: string }[] };
    expect(body.data.map((e) => e.key)).toEqual(["2026casj"]);
  });

  it("does not leak upstream error internals or keys in failures", async () => {
    tba.getEventTeams.mockResolvedValue({ ok: false, status: 401, error: "The data source rejected our credentials." });
    const text = await (await getTeams(req("/x"), ctx({ eventKey: "2026casj" }))).text();
    expect(text).not.toMatch(/X-TBA|api[_-]?key|secret/i);
  });
});
