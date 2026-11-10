"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classifySaveError } from "@/lib/entries/save-error";
import { cacheKeys, cacheSchemas } from "@/lib/offline/cache";
import { readThrough } from "@/lib/offline-ui/cached-fetch";
import { isSupabaseReachabilityError } from "@/lib/offline-ui/reachability";
import { getOfflineStore } from "@/lib/offline-ui/runtime";
import { withTimeout } from "@/lib/offline-ui/timeout";
import { createClient } from "@/lib/supabase/client";
import { toFieldColumns } from "./convert";
import { describeDbError } from "./db-error";
import type { FieldFormValues } from "./form-schema";
import { nextSortOrder } from "./ordering";
import { parseFieldRows } from "./parse";
import type { FieldDefinition } from "./types";

export const fieldKeys = { all: ["fields"] as const };


class FieldsError extends Error {}

const NOT_ALLOWED = "You don't have permission to change fields.";

/**
 * Row-level security does not raise an error when it blocks an UPDATE: it just
 * matches zero rows, which PostgREST reports as success. Every update therefore
 * asks for the affected rows back (.select()) and treats "none" as a permission
 * failure, otherwise a blocked edit would look like it saved.
 */
function assertUpdated(data: unknown[] | null, expected: number) {
  if (!data || data.length < expected) throw new FieldsError(NOT_ALLOWED);
}

/** How long a Supabase read may take before it counts as a network failure (see withTimeout). */
const READ_TIMEOUT_MS = 12_000;

/**
 * All field definitions, including archived ones (Settings shows them so they can
 * be restored; entry forms filter them out). Rows that fail validation are
 * returned separately instead of breaking the list.
 *
 * Written through to the device cache on every successful load. When the server cannot be
 * reached the cached definitions are served instead (`cachedAt` says when they were saved),
 * so the scouting form still opens offline. A broken-row report (`invalid`) only exists for live data.
 */
export function useFields() {
  return useQuery({
    queryKey: fieldKeys.all,
    queryFn: async () => {
      let invalid: ReturnType<typeof parseFieldRows>["invalid"] = [];
      const result = await readThrough<FieldDefinition[]>({
        getStore: () => getOfflineStore().then((opened) => opened.store),
        key: cacheKeys.fields(),
        schema: cacheSchemas.fields,
        fetch: async () => {
          const supabase = createClient();
          const { data, error } = await withTimeout(
            Promise.resolve(
              supabase
                .from("field_definitions")
                .select("*")
                .order("section")
                .order("sort_order")
                .order("name"),
            ),
            READ_TIMEOUT_MS,
            () => classifySaveError(new TypeError("timeout")),
          );
          if (error) {
            // Reachability and sign-in problems keep their classification (the cache fallback and the
            // /login redirect look for it); everything else keeps the readable database message.
            const failure = classifySaveError(error);
            if (failure.kind === "network" || failure.kind === "unauthorized") throw failure;
            throw new FieldsError(describeDbError(error));
          }
          const parsed = parseFieldRows(data ?? []);
          invalid = parsed.invalid;
          return parsed.fields;
        },
        shouldFallback: isSupabaseReachabilityError,
      });
      return { fields: result.value, invalid, cachedAt: result.cachedAt };
    },
    // Field definitions change rarely.
    staleTime: 5 * 60_000,
    // A network failure is not retried (it would just wait while offline): the cached copy answers,
    // or the screen shows an error with a retry button.
    retry: (count, error) => classifySaveError(error).kind === "unknown" && count < 1,
  });
}

/** Active (non-archived) fields: what scouting forms and team lists use. */
export function activeFields(fields: FieldDefinition[]) {
  return fields.filter((f) => !f.archived);
}

function useInvalidateFields() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: fieldKeys.all });
}

export function useCreateField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: async ({ form, existing }: { form: FieldFormValues; existing: FieldDefinition[] }) => {
      const supabase = createClient();
      const { error } = await supabase.from("field_definitions").insert({
        ...toFieldColumns(form),
        sort_order: nextSortOrder(existing, form.section),
      });
      if (error) throw new FieldsError(describeDbError(error));
    },
    onSettled: invalidate,
  });
}

export function useUpdateField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: async ({ id, form, previous, existing }: { id: string; form: FieldFormValues; previous: FieldDefinition; existing: FieldDefinition[] }) => {
      const supabase = createClient();
      const columns = toFieldColumns(form);
      // Moving a field to another section puts it at the end of the new section.
      // (sort_order is a 32-bit integer, so compute a real value; do not use a huge sentinel.)
      const sectionChanged = previous.section !== form.section;
      const others = existing.filter((f) => f.id !== id);
      const { data, error } = await supabase
        .from("field_definitions")
        .update(sectionChanged ? { ...columns, sort_order: nextSortOrder(others, form.section) } : columns)
        .eq("id", id)
        .select("id");
      if (error) throw new FieldsError(describeDbError(error));
      assertUpdated(data, 1);
    },
    onSettled: invalidate,
  });
}

export function useArchiveField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const supabase = createClient();
      const { data, error } = await supabase.from("field_definitions").update({ archived }).eq("id", id).select("id");
      if (error) throw new FieldsError(describeDbError(error));
      assertUpdated(data, 1);
    },
    onSettled: invalidate,
  });
}

export function useReorderFields() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: async (changes: { id: string; sortOrder: number }[]) => {
      const supabase = createClient();
      const results = await Promise.all(
        changes.map((c) =>
          supabase.from("field_definitions").update({ sort_order: c.sortOrder }).eq("id", c.id).select("id"),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new FieldsError(describeDbError(failed.error));
      if (results.some((r) => !r.data || r.data.length < 1)) throw new FieldsError(NOT_ALLOWED);
    },
    // Always refetch, even on partial failure, so the UI shows what actually saved.
    onSettled: invalidate,
  });
}
