import { describe, expect, it } from "vitest";
import { classifySaveError, SaveError } from "./save-error";

describe("classifySaveError", () => {
  it("401 and expired JWTs are 'unauthorized' (keep the data, ask to sign in)", () => {
    expect(classifySaveError({ message: "x" }, 401).kind).toBe("unauthorized");
    expect(
      classifySaveError({ code: "PGRST301", message: "JWT expired" }).kind,
    ).toBe("unauthorized");
    expect(classifySaveError({ message: "JWT expired" }).kind).toBe(
      "unauthorized",
    );
    expect(classifySaveError({ status: 401, message: "" }).kind).toBe(
      "unauthorized",
    );
  });

  it("fetch failures are 'network' and retryable", () => {
    const error = classifySaveError(new TypeError("Failed to fetch"));
    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("RLS refusals are 'permission' and NOT retryable", () => {
    const error = classifySaveError({
      code: "42501",
      message: "new row violates row-level security policy",
    });
    expect(error.kind).toBe("permission");
    expect(error.retryable).toBe(false);
    expect(error.message).not.toMatch(/row-level|policy/i);
  });

  it("constraint violations are 'invalid' and NOT retryable", () => {
    expect(
      classifySaveError({
        code: "23514",
        message: "violates check constraint scouting_entries_rating_check",
      }).kind,
    ).toBe("invalid");
    expect(
      classifySaveError({
        code: "23503",
        message: "violates foreign key constraint",
      }).kind,
    ).toBe("invalid");
    expect(
      classifySaveError({ code: "22P02", message: "invalid input syntax" })
        .kind,
    ).toBe("invalid");
    expect(classifySaveError({ code: "23514", message: "x" }).retryable).toBe(
      false,
    );
  });

  it("quota errors are 'quota'", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(classifySaveError(quota).kind).toBe("quota");
    expect(classifySaveError({ message: "Storage quota exceeded" }).kind).toBe(
      "quota",
    );
  });

  it("unknown errors are retryable but never leak internals", () => {
    const error = classifySaveError({
      code: "XX000",
      message: 'relation "secret_table" exploded',
    });
    expect(error.kind).toBe("unknown");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("secret_table");
  });

  it("accepts string status codes from Storage ('403')", () => {
    expect(classifySaveError({ statusCode: "403", message: "x" }).kind).toBe(
      "permission",
    );
  });

  it("passes an existing SaveError through unchanged", () => {
    const original = new SaveError("quota", "full");
    expect(classifySaveError(original)).toBe(original);
  });

  it("handles non-object throwables", () => {
    expect(classifySaveError(undefined).kind).toBe("unknown");
    expect(classifySaveError("boom").kind).toBe("unknown");
    expect(classifySaveError(null).kind).toBe("unknown");
  });
});
