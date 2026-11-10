"use client";

import { ArchiveIcon, ArchiveRestoreIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FIELD_TYPE_LABELS, TONES, type FieldDefinition } from "@/lib/fields/types";

/** One-line summary of a field's color rule, so the list shows what each field does. */
export function describeRule(field: FieldDefinition): string {
  switch (field.type) {
    case "number": {
      const dir = field.higherIsBetter ? "higher" : "lower";
      const good = field.goodThreshold;
      const bad = field.badThreshold;
      if (good === null && bad === null) return "Not colored";
      const parts: string[] = [];
      if (good !== null) parts.push(`green ${field.higherIsBetter ? "≥" : "≤"} ${good}`);
      if (bad !== null) parts.push(`red ${field.higherIsBetter ? "≤" : "≥"} ${bad}`);
      return `${dir} is better · ${parts.join(", ")}`;
    }
    case "yes_no":
      return field.goodAnswer === null ? "Not colored" : `${field.goodAnswer ? "Yes" : "No"} is good`;
    case "dropdown": {
      const counts = TONES.map((t) => [t, field.options.filter((o) => o.tone === t).length] as const)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${n} ${t === "neutral" ? "okay" : t}`);
      return `${field.options.length} choices · ${counts.join(", ")}`;
    }
    case "text":
      return "Free text";
  }
}

type Props = {
  field: FieldDefinition;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onEdit: () => void;
  onMove: (direction: "up" | "down") => void;
  onArchiveToggle: () => void;
};

export function FieldRow({ field, isFirst, isLast, busy, onEdit, onMove, onArchiveToggle }: Props) {
  return (
    <li className="flex items-center gap-2 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${field.archived ? "text-muted-foreground line-through" : ""}`}>{field.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="secondary">{FIELD_TYPE_LABELS[field.type]}</Badge>
          <span>{describeRule(field)}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center">
          {!field.archived ? (
            <div className="flex flex-col">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                disabled={isFirst || busy}
                onClick={() => onMove("up")}
                aria-label={`Move ${field.name} up`}
              >
                <ChevronUpIcon aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                disabled={isLast || busy}
                onClick={() => onMove("down")}
                aria-label={`Move ${field.name} down`}
              >
                <ChevronDownIcon aria-hidden />
              </Button>
            </div>
          ) : null}
          {!field.archived ? (
            <Button type="button" variant="ghost" size="icon-lg" className="size-11" onClick={onEdit} aria-label={`Edit ${field.name}`}>
              <PencilIcon aria-hidden />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-11"
            disabled={busy}
            onClick={onArchiveToggle}
            aria-label={field.archived ? `Restore ${field.name}` : `Archive ${field.name}`}
          >
            {field.archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />}
          </Button>
        </div>
    </li>
  );
}
