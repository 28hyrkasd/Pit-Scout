import { describe, expect, it } from "vitest";
import { assertUploadable, PHOTO_MAX_BYTES, PhotoError } from "./compress";

describe("assertUploadable", () => {
  it("accepts a normal compressed JPEG", () => {
    expect(() =>
      assertUploadable({ type: "image/jpeg", size: 400_000 }),
    ).not.toThrow();
    expect(() =>
      assertUploadable({ type: "image/jpeg", size: PHOTO_MAX_BYTES }),
    ).not.toThrow();
  });

  it("rejects anything over the ceiling", () => {
    expect(() =>
      assertUploadable({ type: "image/jpeg", size: PHOTO_MAX_BYTES + 1 }),
    ).toThrow(PhotoError);
  });

  it("rejects non-JPEG output and empty files", () => {
    expect(() => assertUploadable({ type: "image/png", size: 100 })).toThrow(
      PhotoError,
    );
    expect(() => assertUploadable({ type: "", size: 100 })).toThrow(PhotoError);
    expect(() => assertUploadable({ type: "image/jpeg", size: 0 })).toThrow(
      PhotoError,
    );
  });
});
