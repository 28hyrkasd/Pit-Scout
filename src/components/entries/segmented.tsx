"use client";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Accessible name for the group (visible labels sit outside this component). */
  labelledBy: string;
  options: SegmentedOption<T>[];
  /** null = nothing chosen. */
  value: T | null;
  onChange: (value: T | null) => void;
  /** Tapping the chosen option again clears it (answers are optional). Default true. */
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

/**
 * Big, thumb-friendly choice buttons (48px tall). Used for yes/no, short
 * dropdowns and the 1-5 rating, where a native <select> would need two taps and a
 * scroll wheel. Toggle buttons with aria-pressed, which every screen reader
 * announces as "pressed/not pressed"; selection is also shown with a check-style
 * fill and a ring, not by color alone.
 */
export function Segmented<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  clearable = true,
  disabled,
  invalid,
  className,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      data-invalid={invalid || undefined}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() =>
              onChange(selected && clearable ? null : option.value)
            }
            className={cn(
              "min-h-12 min-w-12 flex-1 rounded-lg border px-3 text-base font-medium transition-colors outline-none select-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30"
                : "border-input bg-background hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
              invalid && !selected && "border-destructive",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
