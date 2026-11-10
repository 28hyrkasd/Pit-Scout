import { describe, expect, it } from "vitest";
import { nextUpdatedAt } from "./clock";

const NOW = Date.parse("2026-11-09T20:00:00.000Z");

describe("nextUpdatedAt", () => {
  it("uses the current time for a new entry", () => {
    expect(nextUpdatedAt(NOW, null)).toBe("2026-11-09T20:00:00.000Z");
  });

  it("uses the current time when it is after the stored time", () => {
    expect(nextUpdatedAt(NOW, "2026-11-09T19:00:00+00:00")).toBe(
      "2026-11-09T20:00:00.000Z",
    );
  });

  it("never goes backwards when this phone's clock is behind the stored time", () => {
    expect(nextUpdatedAt(NOW, "2026-11-09T20:10:00+00:00")).toBe(
      "2026-11-09T20:10:00.001Z",
    );
  });

  it("moves forward by 1ms when the times are equal", () => {
    expect(nextUpdatedAt(NOW, "2026-11-09T20:00:00.000Z")).toBe(
      "2026-11-09T20:00:00.001Z",
    );
  });

  it("ignores an unparseable stored time", () => {
    expect(nextUpdatedAt(NOW, "garbage")).toBe("2026-11-09T20:00:00.000Z");
  });
});
