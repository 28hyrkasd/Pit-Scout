import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the value when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, () => new Error("slow"))).resolves.toBe(7);
  });

  it("rejects with the made error when the promise hangs", async () => {
    const hung = new Promise<number>(() => {});
    const result = withTimeout(hung, 1000, () => new Error("too slow"));
    const assertion = expect(result).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not time out before the limit", async () => {
    let resolve!: (n: number) => void;
    const p = new Promise<number>((r) => (resolve = r));
    const result = withTimeout(p, 1000, () => new Error("too slow"));
    await vi.advanceTimersByTimeAsync(999);
    resolve(1);
    await expect(result).resolves.toBe(1);
  });

  it("passes the original rejection through unchanged and clears the timer", async () => {
    const original = { code: "X", message: "boom" };
    await expect(withTimeout(Promise.reject(original), 1000, () => new Error("slow"))).rejects.toBe(original);
    expect(vi.getTimerCount()).toBe(0);
  });
});
