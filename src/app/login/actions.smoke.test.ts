import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real `login` action with a real FormData, with the Supabase
// client and Next's redirect mocked, so we test our own logic (validation,
// generic failure message, safe redirect) without HTTP or a real account.

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut: vi.fn() } }),
}));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

import { login } from "./actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("login action", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    vi.useRealTimers();
  });

  it("rejects empty fields without calling Supabase", async () => {
    const result = await login(undefined, form({ email: "", password: "" }));
    expect(result?.errors?.email?.[0]).toBe("Enter your email");
    expect(result?.errors?.password?.[0]).toBe("Enter your password");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without calling Supabase and echoes it back", async () => {
    const result = await login(undefined, form({ email: "not-an-email", password: "x" }));
    expect(result?.errors?.email?.[0]).toBe("Enter a valid email");
    expect(result?.email).toBe("not-an-email");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("returns one generic message for bad credentials, and keeps the email", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthApiError", status: 400, message: "Invalid login credentials" } });
    const started = Date.now();
    const result = await login(undefined, form({ email: "a@b.co", password: "wrong" }));
    expect(result?.message).toBe("Incorrect email or password.");
    expect(result?.email).toBe("a@b.co");
    expect(Date.now() - started).toBeGreaterThanOrEqual(700); // failure delay
  });

  it("gives a connectivity message (not a credentials message) on network errors", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } });
    const result = await login(undefined, form({ email: "a@b.co", password: "pw" }));
    expect(result?.message).toMatch(/can't reach the server/i);
  });

  it("trims the email before signing in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(login(undefined, form({ email: "  a@b.co  ", password: "pw" }))).rejects.toBeInstanceOf(RedirectSignal);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@b.co", password: "pw" });
  });

  it("redirects to a safe ?next on success", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      login(undefined, form({ email: "a@b.co", password: "pw", next: "/teams/254?tab=photos" })),
    ).rejects.toMatchObject({ url: "/teams/254?tab=photos" });
  });

  it("ignores a hostile ?next and goes home", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      await expect(
        login(undefined, form({ email: "a@b.co", password: "pw", next: evil })),
      ).rejects.toMatchObject({ url: "/" });
    }
  });
});
