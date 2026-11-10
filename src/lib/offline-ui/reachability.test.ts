import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { SaveError } from "@/lib/entries/save-error";
import { isApiReachabilityError, isSupabaseReachabilityError } from "./reachability";

describe("reachability predicates", () => {
  it("API: network and upstream failures fall back to saved data; auth/not-found/invalid do not", () => {
    expect(isApiReachabilityError(new ApiError("network", "x"))).toBe(true);
    expect(isApiReachabilityError(new ApiError("upstream", "x"))).toBe(true);
    for (const kind of ["unauthorized", "not_found", "invalid"] as const)
      expect(isApiReachabilityError(new ApiError(kind, "x"))).toBe(false);
    expect(isApiReachabilityError(new Error("x"))).toBe(false);
  });

  it("Supabase: only real network failures qualify", () => {
    expect(isSupabaseReachabilityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isSupabaseReachabilityError(new SaveError("network", "x"))).toBe(true);
    expect(isSupabaseReachabilityError(new SaveError("unauthorized", "x"))).toBe(false);
    expect(isSupabaseReachabilityError({ status: 401, message: "JWT expired" })).toBe(false);
    expect(isSupabaseReachabilityError({ code: "42501", message: "denied" })).toBe(false);
  });
});
