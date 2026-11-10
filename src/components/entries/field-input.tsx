"use client";

import { useId } from "react";
import { Controller, type Control } from "react-hook-form";
import { ColorChip } from "@/components/fields/color-chip";
import { Segmented } from "@/components/entries/segmented";
import { Input } from "@/components/ui/input";
import { toAnswerValue } from "@/lib/entries/payload";
import type { EntryFormValues } from "@/lib/entries/form";
import { rateAnswer } from "@/lib/fields/colors";
import { formatAnswer } from "@/lib/fields/format";
import type { FieldDefinition } from "@/lib/fields/types";
import { cn } from "@/lib/utils";

/** Up to this many options are shown as buttons; more would not fit a phone screen. */
const SEGMENTED_MAX_OPTIONS = 4;

const CONTROL_CLASS =
  "w-full rounded-lg border border-input bg-transparent px-3 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:opacity-50 dark:bg-input/30";

type Props = {
  field: FieldDefinition;
  control: Control<EntryFormValues>;
  error?: string;
  disabled?: boolean;
};

/** One scouting question, rendered for its type, with a live color chip once answered. */
export function FieldInput({ field, control, error, disabled }: Props) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={`answers.${field.id}`}
      render={({ field: input }) => {
        const answer = toAnswerValue(field, input.value);
        const rating = rateAnswer(field, answer);
        // Free text has no good/bad, so a chip on it would only say "okay" for any text.
        const showChip = field.type !== "text" && rating !== "none";

        return (
          <div className="flex flex-col gap-2" data-field-id={field.id}>
            <div className="flex min-h-7 items-center justify-between gap-2">
              <label id={labelId} htmlFor={id} className="text-sm font-medium">
                {field.name}
              </label>
              {showChip ? (
                <ColorChip rating={rating}>
                  {formatAnswer(field, answer) ?? ""}
                </ColorChip>
              ) : null}
            </div>

            {field.type === "number" ? (
              <Input
                id={id}
                ref={input.ref}
                name={input.name}
                value={typeof input.value === "string" ? input.value : ""}
                onChange={(e) => input.onChange(e.target.value)}
                onBlur={input.onBlur}
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="next"
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-12 px-3"
              />
            ) : null}

            {field.type === "yes_no" ? (
              <Segmented
                labelledBy={labelId}
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ]}
                value={
                  input.value === true
                    ? "yes"
                    : input.value === false
                      ? "no"
                      : null
                }
                onChange={(next) =>
                  input.onChange(next === null ? null : next === "yes")
                }
                disabled={disabled}
                invalid={Boolean(error)}
              />
            ) : null}

            {field.type === "dropdown" &&
            field.options.length <= SEGMENTED_MAX_OPTIONS ? (
              <Segmented
                labelledBy={labelId}
                options={field.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                value={
                  typeof input.value === "string" && input.value !== ""
                    ? input.value
                    : null
                }
                onChange={(next) => input.onChange(next ?? "")}
                disabled={disabled}
                invalid={Boolean(error)}
              />
            ) : null}

            {field.type === "dropdown" &&
            field.options.length > SEGMENTED_MAX_OPTIONS ? (
              // Native <select>: the phone's own picker is the best UI for a long list.
              <select
                id={id}
                ref={input.ref}
                name={input.name}
                value={typeof input.value === "string" ? input.value : ""}
                onChange={(e) => input.onChange(e.target.value)}
                onBlur={input.onBlur}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn(CONTROL_CLASS, "h-12")}
              >
                <option value="">Not answered</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : null}

            {field.type === "text" ? (
              <textarea
                id={id}
                ref={input.ref}
                name={input.name}
                value={typeof input.value === "string" ? input.value : ""}
                onChange={(e) => input.onChange(e.target.value)}
                onBlur={input.onBlur}
                rows={2}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn(CONTROL_CLASS, "min-h-12 resize-y py-3")}
              />
            ) : null}

            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      }}
    />
  );
}
