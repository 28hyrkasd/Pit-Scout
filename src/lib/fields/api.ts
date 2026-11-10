"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * All field definitions, including archived ones (Settings shows them so they can
 * be restored; entry forms filter them out). Rows that fail validation are
 * returned separately instead of breaking the list.
 */
export function useFields() {
  return useQuery({
    queryKey: fieldKeys.all,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("field_definitions")
        .select("*")
        .order("section")
        .order("sort_order")
        .order("name");
      if (error) throw new FieldsError(describeDbError(error));
      return parseFieldRows(data ?? []);
    },
    // Field definitions change rarely. Phase 8 also caches them in IndexedDB.
    staleTime: 5 * 60_000,
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
