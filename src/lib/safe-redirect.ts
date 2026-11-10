/**
 * Returns `target` only if it is a safe, same-origin, in-app path; otherwise the
 * fallback. Used for the `?next=` parameter after login to prevent open-redirect
 * attacks (e.g. `?next=https://evil.example` or `?next=//evil.example`).
 *
 * Accepted: "/", "/teams/254", "/teams/254?tab=photos"
 * Rejected: absolute URLs, protocol-relative ("//host"), backslash tricks
 *           ("/\host"), control characters, and the login page itself.
 */
export function safeRedirectPath(target: string | null | undefined, fallback = "/"): string {
  if (!target) return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
  // Reject control characters and backslashes anywhere (browsers normalize `\` to `/`).
  if (/[\u0000-\u001f\u007f\\]/.test(target)) return fallback;

  // Final check: resolving against a dummy origin must stay on that origin.
  try {
    const base = "http://pit-scout.invalid";
    const url = new URL(target, base);
    if (url.origin !== base) return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
