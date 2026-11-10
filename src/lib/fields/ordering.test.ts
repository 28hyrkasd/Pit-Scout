import { describe, expect, it } from "vitest";
import { moveWithinSection, nextSortOrder } from "./ordering";

const f = (id: string, sortOrder: number, section: "specs" | "auto" = "specs") => ({ id, sortOrder, section });

describe("nextSortOrder", () => {
  it("starts a new section at 10", () => {
    expect(nextSortOrder([], "specs")).toBe(10);
    expect(nextSortOrder([f("a", 50, "auto")], "specs")).toBe(10);
  });

  it("goes after the highest in that section only", () => {
    const fields = [f("a", 10), f("b", 30), f("c", 999, "auto")];
    expect(nextSortOrder(fields, "specs")).toBe(40);
    expect(nextSortOrder(fields, "auto")).toBe(1009);
  });

  it("is unaffected by the order the fields are passed in", () => {
    expect(nextSortOrder([f("b", 30), f("a", 10)], "specs")).toBe(40);
  });
});

describe("moveWithinSection", () => {
  const list = [f("a", 10), f("b", 20), f("c", 30)];

  it("moves a field up: swaps it with the one above", () => {
    expect(moveWithinSection(list, "b", "up")).toEqual([
      { id: "b", sortOrder: 10 },
      { id: "a", sortOrder: 20 },
    ]);
  });

  it("moves a field down: swaps it with the one below", () => {
    expect(moveWithinSection(list, "b", "down")).toEqual([
      { id: "c", sortOrder: 20 },
      { id: "b", sortOrder: 30 },
    ]);
  });

  it("only returns the rows that actually changed", () => {
    expect(moveWithinSection(list, "a", "down").map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("returns nothing when the move is impossible", () => {
    expect(moveWithinSection(list, "a", "up")).toEqual([]);
    expect(moveWithinSection(list, "c", "down")).toEqual([]);
    expect(moveWithinSection(list, "missing", "up")).toEqual([]);
    expect(moveWithinSection([], "a", "up")).toEqual([]);
    expect(moveWithinSection([f("only", 10)], "only", "down")).toEqual([]);
  });

  it("handles fields that share a sort_order (a tie): the result is unambiguous", () => {
    const tied = [f("a", 10), f("b", 10), f("c", 10)];
    const changes = moveWithinSection(tied, "c", "up");
    const result = [...tied].map((x) => ({ id: x.id, sortOrder: x.sortOrder }));
    for (const c of changes) result.find((x) => x.id === c.id)!.sortOrder = c.sortOrder;
    // Display order after the move must be a, c, b.
    expect(result.sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(new Set(result.map((x) => x.sortOrder)).size).toBe(3); // ties are resolved
  });

  it("repeated moves always produce a consistent total order (no ties or gaps in meaning)", () => {
    let fields = [f("a", 10), f("b", 20), f("c", 30), f("d", 40)];
    const apply = (id: string, dir: "up" | "down") => {
      const changes = moveWithinSection(fields, id, dir);
      fields = fields.map((x) => ({ ...x, sortOrder: changes.find((c) => c.id === x.id)?.sortOrder ?? x.sortOrder }));
      fields.sort((x, y) => x.sortOrder - y.sortOrder);
    };

    // Independent model: a plain array swap, so the expectation is not just a copy of the code's output.
    const model = ["a", "b", "c", "d"];
    const swap = (id: string, dir: "up" | "down") => {
      const i = model.indexOf(id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < model.length) [model[i], model[j]] = [model[j], model[i]];
    };

    for (const [id, dir] of [["d", "up"], ["d", "up"], ["a", "down"]] as const) {
      apply(id, dir);
      swap(id, dir);
    }
    // a b c d -> d up: a b d c -> d up: a d b c -> a down: d a b c
    expect(model).toEqual(["d", "a", "b", "c"]);
    expect(fields.map((x) => x.id)).toEqual(model);
    expect(new Set(fields.map((x) => x.sortOrder)).size).toBe(4);
  });
});
