import { describe, expect, it, vi } from "vitest";
import {
  parseEntryRow,
  upsertScoutingEntry,
  wasApplied,
  type UpsertEntryInput,
} from "./rpc";

const INPUT: UpsertEntryInput = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventKey: "2026casj",
  teamNumber: 254,
  payload: {
    answers: { f1: 0, f2: false, f3: null },
    rating: null,
    notes: null,
    scoutedBy: null,
  },
  createdAt: "2026-11-09T20:00:00.000Z",
  updatedAt: "2026-11-09T20:01:00.000Z",
};

const ROW = {
  id: INPUT.id,
  event_key: "2026casj",
  team_number: 254,
  answers: { f1: 0, f2: false, f3: null },
  rating: null,
  notes: null,
  scouted_by: null,
  created_by: null,
  created_at: "2026-11-09T20:00:00+00:00",
  updated_at: "2026-11-09T20:01:00+00:00",
};

function fakeClient(result: {
  data: unknown;
  error: unknown;
  status?: number;
}) {
  const rpc = vi.fn().mockResolvedValue({ status: 200, ...result });
  return { client: { rpc } as never, rpc };
}

describe("upsertScoutingEntry", () => {
  it("maps the input to the RPC's named parameters and passes nulls through", async () => {
    const { client, rpc } = fakeClient({ data: ROW, error: null });
    await upsertScoutingEntry(client, INPUT);
    expect(rpc).toHaveBeenCalledWith("upsert_scouting_entry", {
      p_id: INPUT.id,
      p_event_key: "2026casj",
      p_team_number: 254,
      p_answers: { f1: 0, f2: false, f3: null },
      p_rating: null,
      p_notes: null,
      p_scouted_by: null,
      p_created_at: INPUT.createdAt,
      p_updated_at: INPUT.updatedAt,
    });
  });

  it("returns the SURVIVING row, which may have a different id than the one sent", async () => {
    const { client } = fakeClient({
      data: { ...ROW, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      error: null,
    });
    const saved = await upsertScoutingEntry(client, INPUT);
    expect(saved.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(saved.id).not.toBe(INPUT.id);
    expect(saved.answers).toEqual({ f1: 0, f2: false, f3: null });
  });

  it("throws a classified SaveError on a database error", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "42501", message: "rls" },
      status: 403,
    });
    await expect(upsertScoutingEntry(client, INPUT)).rejects.toMatchObject({
      name: "SaveError",
      kind: "permission",
    });
  });

  it("maps a 401 to 'unauthorized'", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "JWT expired" },
      status: 401,
    });
    await expect(upsertScoutingEntry(client, INPUT)).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("rejects a response that is not an entry row", async () => {
    const { client } = fakeClient({ data: { hello: "world" }, error: null });
    await expect(upsertScoutingEntry(client, INPUT)).rejects.toMatchObject({
      kind: "unknown",
    });
  });
});

describe("parseEntryRow", () => {
  it("maps snake_case to camelCase", () => {
    expect(parseEntryRow(ROW)).toMatchObject({
      eventKey: "2026casj",
      teamNumber: 254,
      scoutedBy: null,
      updatedAt: ROW.updated_at,
    });
  });

  it("returns null for junk", () => {
    expect(parseEntryRow(null)).toBeNull();
    expect(parseEntryRow({ ...ROW, team_number: "254" })).toBeNull();
  });
});

describe("wasApplied", () => {
  it("compares instants, not strings", () => {
    expect(
      wasApplied(
        { updatedAt: "2026-11-09T20:01:00+00:00" },
        "2026-11-09T20:01:00.000Z",
      ),
    ).toBe(true);
    expect(
      wasApplied(
        { updatedAt: "2026-11-09T15:01:00-05:00" },
        "2026-11-09T20:01:00.000Z",
      ),
    ).toBe(true);
  });

  it("is false when the stored row is a different (newer) instant", () => {
    expect(
      wasApplied(
        { updatedAt: "2026-11-09T20:02:00+00:00" },
        "2026-11-09T20:01:00.000Z",
      ),
    ).toBe(false);
  });
});
