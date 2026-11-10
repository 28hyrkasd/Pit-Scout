import { describe, expect, it } from "vitest";
import { describeDbError } from "./db-error";

describe("describeDbError", () => {
  it.each([
    ["42501", /permission/i],
    ["23514", /aren't allowed/i],
    ["23505", /already exists/i],
    ["22003", /too large/i],
    ["PGRST301", /session expired/i],
    ["PGRST303", /session expired/i],
  ])("maps code %s", (code, expected) => {
    expect(describeDbError({ code, message: "raw db text" })).toMatch(expected);
  });

  it.each(["TypeError: Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "request timeout"])(
    "treats %j as a connectivity problem",
    (message) => {
      expect(describeDbError({ message })).toMatch(/can't reach the server/i);
    },
  );

  it("falls back to a generic message for unknown errors", () => {
    expect(describeDbError({ code: "XX000", message: "boom" })).toMatch(/something went wrong/i);
    expect(describeDbError(null)).toMatch(/something went wrong/i);
    expect(describeDbError(undefined)).toMatch(/something went wrong/i);
    expect(describeDbError("a string")).toMatch(/something went wrong/i);
  });

  it("never leaks raw SQL, constraint or table names into the message", () => {
    const leaky = {
      code: "23514",
      message: 'new row for relation "field_definitions" violates check constraint "field_thresholds_ordered"',
      details: "Failing row contains (...)",
    };
    const text = describeDbError(leaky);
    expect(text).not.toMatch(/field_definitions|field_thresholds_ordered|violates|relation|Failing row/i);
  });

  it("prefers a known code over a message that merely mentions network words", () => {
    expect(describeDbError({ code: "42501", message: "network permission fetch" })).toMatch(/permission/i);
  });
});
