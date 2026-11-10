import { beforeEach, describe, expect, it, vi } from "vitest";

const { connection } = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("next/server", () => ({ connection }));

import { GET, HEAD } from "./route";

describe("/api/health", () => {
  beforeEach(() => {
    connection.mockReset();
    connection.mockResolvedValue(undefined);
  });

  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
  ])("%s answers 204, uncacheable, with no body", async (_m, handler) => {
    const res = await handler();
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
  ])("%s waits for a real request first (never prerendered, so it reflects reachability)", async (_m, handler) => {
    await handler();
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("needs no session and leaks nothing", async () => {
    const res = await GET();
    expect([...res.headers.keys()]).toEqual(["cache-control"]);
  });
});
