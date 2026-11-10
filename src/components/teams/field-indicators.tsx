import { XIcon } from "lucide-react";
import { ColorChip, ratingLabel } from "@/components/fields/color-chip";
import type { FieldDefinition, Rating } from "@/lib/fields/types";
import { cn } from "@/lib/utils";

/** Beyond this many fields the row stops growing and shows a "+N" summary instead. */
export const MAX_VISIBLE_INDICATORS = 12;

type Props = {
  /** Active fields in display order. */
  fields: FieldDefinition[];
  /** One rating per field, aligned with `fields`. */
  ratings: Rating[];
  max?: number;
};

/**
 * A compact row of one icon-dot per field. Each dot has an icon (never color
 * alone) and a screen-reader label "Field name: Good". With a very large number of
 * fields only the first `max` are drawn, followed by "+N"; the "+N" turns red when
 * any hidden field is bad, so a problem is never hidden behind the cap.
 */
export function FieldIndicators({ fields, ratings, max = MAX_VISIBLE_INDICATORS }: Props) {
  if (fields.length === 0) return null;

  const visible = Math.min(fields.length, max);
  const hidden = fields.length - visible;
  let hiddenBad = 0;
  for (let i = visible; i < fields.length; i++) if (ratings[i] === "bad") hiddenBad++;

  return (
    <ul aria-label="Field ratings" className="flex min-w-0 flex-wrap items-center gap-1">
      {fields.slice(0, visible).map((field, i) => {
        const rating = ratings[i] ?? "none";
        return (
          <li key={field.id} title={`${field.name}: ${ratingLabel(rating)}`} className="flex">
            <span className="sr-only">{field.name}</span>
            <ColorChip rating={rating} className="size-5 min-h-0 justify-center gap-0 p-0" />
          </li>
        );
      })}
      {hidden > 0 ? (
        <li
          className={cn(
            "inline-flex h-5 items-center rounded-full px-1.5 text-xs font-medium tabular-nums ring-1 ring-inset",
            hiddenBad > 0
              ? "bg-red-100 text-red-900 ring-red-600/30 dark:bg-red-950 dark:text-red-200 dark:ring-red-500/40"
              : "bg-muted text-muted-foreground ring-foreground/10",
          )}
        >
          {hiddenBad > 0 ? <XIcon className="mr-0.5 size-3" aria-hidden /> : null}+{hidden}
          <span className="sr-only">
            {` more field${hidden === 1 ? "" : "s"}${hiddenBad > 0 ? `, ${hiddenBad} bad` : ""}`}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
