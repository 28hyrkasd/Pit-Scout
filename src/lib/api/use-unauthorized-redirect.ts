"use client";

import { useEffect } from "react";
import { handleUnauthorized } from "@/lib/api/queries";

/**
 * Send the user to /login when ANY kind of query error means their session expired:
 * the API routes (ApiError "unauthorized") and direct Supabase reads (a JWT error).
 * Read-only screens: nothing the scout saved can be lost (it is in IndexedDB), and a
 * form with unsaved on-screen edits blocks the redirect (see loginRedirectUrl).
 */
export function useRedirectOnUnauthorized(error: unknown) {
  useEffect(() => {
    if (error) handleUnauthorized(error);
  }, [error]);
}
