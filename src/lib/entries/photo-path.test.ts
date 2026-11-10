import { describe, expect, it } from "vitest";
import { photoStoragePath } from "./photo-path";

const ID = "9f1c2a3b-4d5e-4f60-8a7b-0c1d2e3f4a5b";

describe("photoStoragePath", () => {
  it("builds {event_key}/{team_number}/{photo_uuid}.jpg", () => {
    expect(photoStoragePath("2026casj", 254, ID)).toBe(
      `2026casj/254/${ID}.jpg`,
    );
  });

  it("is deterministic, so a retried upload targets the same object", () => {
    expect(photoStoragePath("2026casj", 254, ID)).toBe(
      photoStoragePath("2026casj", 254, ID),
    );
  });

  it("lowercases the uuid so case never creates a second object", () => {
    expect(photoStoragePath("2026casj", 254, ID.toUpperCase())).toBe(
      `2026casj/254/${ID}.jpg`,
    );
  });

  it.each([
    ["../x", 254, ID],
    ["2026casj/..", 254, ID],
    ["2026CASJ", 254, ID],
    ["", 254, ID],
    ["2026casj", 0, ID],
    ["2026casj", -1, ID],
    ["2026casj", 1.5, ID],
    ["2026casj", 100000, ID],
    ["2026casj", Number.NaN, ID],
    ["2026casj", 254, "not-a-uuid"],
    ["2026casj", 254, `${ID}/../../x`],
    ["2026casj", 254, ""],
  ])("rejects %j / %j / %j", (eventKey, team, id) => {
    expect(() => photoStoragePath(eventKey, team, id)).toThrow();
  });
});
