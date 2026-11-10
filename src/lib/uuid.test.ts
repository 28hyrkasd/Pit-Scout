import { describe, expect, it } from "vitest";
import { newUuid, UUID_PATTERN } from "./uuid";

describe("newUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(
      newUuid({
        randomUUID: () => id,
        getRandomValues: ((a: Uint8Array) => a) as never,
      }),
    ).toBe(id);
  });

  it("falls back to getRandomValues (plain-http contexts have no randomUUID)", () => {
    let counter = 0;
    const fake = {
      getRandomValues: ((array: Uint8Array) => {
        for (let i = 0; i < array.length; i++)
          array[i] = (counter += 37) & 0xff;
        return array;
      }) as never,
    };
    const a = newUuid(fake);
    const b = newUuid(fake);
    expect(a).toMatch(UUID_PATTERN);
    expect(a[14]).toBe("4"); // version nibble
    expect("89ab").toContain(a[19]); // variant nibble
    expect(a).not.toBe(b);
  });

  it("produces valid, distinct ids from the real runtime", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newUuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_PATTERN);
  });
});
