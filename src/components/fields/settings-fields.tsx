"use client";

import { useMemo, useState } from "react";
import { AlertTriangleIcon, ChevronRightIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { FieldEditor } from "@/components/fields/field-editor";
import { FieldRow } from "@/components/fields/field-row";
import { Button } from "@/components/ui/button";
import { useArchiveField, useFields, useReorderFields } from "@/lib/fields/api";
import { moveWithinSection } from "@/lib/fields/ordering";
import { SECTIONS, SECTION_LABELS, type FieldDefinition, type Section } from "@/lib/fields/types";

type EditorState = { open: boolean; field: FieldDefinition | null; section: Section };

export function SettingsFields() {
  const fieldsQuery = useFields();
  const archive = useArchiveField();
  const reorder = useReorderFields();
  const [editor, setEditor] = useState<EditorState>({ open: false, field: null, section: "specs" });
  const [showArchived, setShowArchived] = useState(false);

  const all = useMemo(() => fieldsQuery.data?.fields ?? [], [fieldsQuery.data]);
  const active = useMemo(() => all.filter((f) => !f.archived), [all]);
  const archived = useMemo(() => all.filter((f) => f.archived), [all]);
  const busy = archive.isPending || reorder.isPending;

  const openNew = (section: Section) => setEditor({ open: true, field: null, section });
  const openEdit = (field: FieldDefinition) => setEditor({ open: true, field, section: field.section });

  async function toggleArchive(field: FieldDefinition) {
    try {
      await archive.mutateAsync({ id: field.id, archived: !field.archived });
      toast.success(field.archived ? `Restored "${field.name}"` : `Archived "${field.name}". Its data is kept.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the field.");
    }
  }

  async function move(field: FieldDefinition, direction: "up" | "down") {
    const inSection = active.filter((f) => f.section === field.section);
    const changes = moveWithinSection(inSection, field.id, direction);
    if (changes.length === 0) return;
    try {
      await reorder.mutateAsync(changes);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder fields.");
    }
  }

  if (fieldsQuery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy aria-label="Loading fields">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (fieldsQuery.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <p className="text-sm">{fieldsQuery.error instanceof Error ? fieldsQuery.error.message : "Could not load fields."}</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => fieldsQuery.refetch()}>
          <RefreshCwIcon aria-hidden /> Try again
        </Button>
      </div>
    );
  }

  const invalid = fieldsQuery.data.invalid;

  return (
    <div className="flex flex-col gap-6">
      {invalid.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
            {invalid.length === 1 ? "1 field has a problem and is hidden" : `${invalid.length} fields have problems and are hidden`}
          </p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {invalid.map((f) => (
              <li key={f.id}>
                <span className="font-medium text-foreground">{f.name}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {active.length === 0 && invalid.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No fields yet. Add one to start building your scouting form.
        </p>
      ) : null}

      {SECTIONS.map((section) => {
        const fields = active.filter((f) => f.section === section);
        return (
          <section key={section} aria-labelledby={`section-${section}`} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 id={`section-${section}`} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {SECTION_LABELS[section]}
              </h2>
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => openNew(section)}>
                <PlusIcon aria-hidden /> Add
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing here yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {fields.map((field, index) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    isFirst={index === 0}
                    isLast={index === fields.length - 1}
                    busy={busy}
                    onEdit={() => openEdit(field)}
                    onMove={(direction) => move(field, direction)}
                    onArchiveToggle={() => toggleArchive(field)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Archived fields">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="flex h-11 items-center gap-2 self-start rounded-lg px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRightIcon className={`size-4 transition-transform ${showArchived ? "rotate-90" : ""}`} aria-hidden />
            Archived ({archived.length})
          </button>
          {showArchived ? (
            <>
              <p className="text-xs text-muted-foreground">
                Archived fields are hidden from scouting forms. Their data is kept, and comes back if you restore them.
              </p>
              <ul className="flex flex-col gap-2">
                {archived.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    isFirst
                    isLast
                    busy={busy}
                    onEdit={() => openEdit(field)}
                    onMove={() => {}}
                    onArchiveToggle={() => toggleArchive(field)}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <FieldEditor
        open={editor.open}
        onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
        field={editor.field}
        defaultSection={editor.section}
        allFields={all}
      />
    </div>
  );
}
