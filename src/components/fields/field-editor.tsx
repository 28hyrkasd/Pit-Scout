"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { AlertTriangleIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ColorChip } from "@/components/fields/color-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCreateField, useUpdateField } from "@/lib/fields/api";
import { rateNumber } from "@/lib/fields/colors";
import { editWarnings, toFormValues } from "@/lib/fields/convert";
import { emptyFieldForm, fieldFormSchema, type FieldFormValues } from "@/lib/fields/form-schema";
import { sampleNumbers } from "@/lib/fields/preview";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  SECTIONS,
  SECTION_LABELS,
  TONES,
  type FieldDefinition,
  type Section,
  type Tone,
} from "@/lib/fields/types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creating a new field. */
  field: FieldDefinition | null;
  /** Section pre-selected when creating. */
  defaultSection: Section;
  /** All fields, used to place new fields and to detect duplicate names. */
  allFields: FieldDefinition[];
};

const TONE_LABEL: Record<Tone, string> = { good: "Good", neutral: "Okay", bad: "Bad" };

export function FieldEditor({ open, onOpenChange, field, defaultSection, allFields }: Props) {
  const create = useCreateField();
  const update = useUpdateField();
  // The warnings the user has already acknowledged, as one string. "Confirmed" is
  // DERIVED by comparing with the current warnings, so it clears automatically when
  // the edit changes (a new warning is never silently pre-approved) and when the
  // sheet closes, without an effect to reset it.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);

  const form = useForm<FieldFormValues>({
    resolver: zodResolver(fieldFormSchema),
    defaultValues: emptyFieldForm(defaultSection),
  });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const { errors, isSubmitting } = formState;
  const options = useFieldArray({ control, name: "options" });

  // Load the field being edited (or a blank form) each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    reset(field ? toFormValues(field) : emptyFieldForm(defaultSection));
  }, [open, field, defaultSection, reset]);

  const values = useWatch({ control });
  const type = values.type ?? "number";
  const warnings = useMemo(
    () => (field && values.name !== undefined ? editWarnings(field, values as FieldFormValues) : []),
    [field, values],
  );

  const warningKey = warnings.join("\n");
  const confirmed = warnings.length > 0 && acknowledged === warningKey;
  const saving = create.isPending || update.isPending || isSubmitting;

  async function onSubmit(data: FieldFormValues) {
    // Names must be unique among ACTIVE fields in the section, or scouts see two identical rows.
    const clash = allFields.some(
      (f) =>
        !f.archived &&
        f.id !== field?.id &&
        f.section === data.section &&
        f.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
    );
    if (clash) {
      setError("name", { message: "There is already a field with that name in this section" });
      return;
    }

    // Risky edits need an explicit second tap.
    if (warnings.length > 0 && !confirmed) {
      setAcknowledged(warningKey);
      return;
    }

    try {
      if (field) await update.mutateAsync({ id: field.id, form: data, previous: field, existing: allFields });
      else await create.mutateAsync({ form: data, existing: allFields });
      toast.success(field ? "Field updated" : "Field added");
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the field.");
    }
  }

  // Every way of closing (Cancel, backdrop tap, Escape, swipe) goes through here, so a
  // confirmation never outlives the sheet it was given in.
  function handleOpenChange(next: boolean) {
    if (!next) setAcknowledged(null);
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 rounded-t-2xl p-0">
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>{field ? "Edit field" : "New field"}</SheetTitle>
            <SheetDescription>
              {field ? "Changes recolor existing scouting data right away." : "Fields appear on every scouting form."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="field-name">Name</Label>
              <Input
                id="field-name"
                autoComplete="off"
                className="h-12 text-base"
                aria-invalid={errors.name ? true : undefined}
                {...register("name")}
              />
              <FieldError message={errors.name?.message} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="field-section">Section</Label>
                <NativeSelect id="field-section" {...register("section")}>
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="field-type">Type</Label>
                <NativeSelect id="field-type" {...register("type")}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {type === "number" ? (
              <NumberSettings
                control={control}
                register={register}
                errors={errors}
                higherIsBetter={values.higherIsBetter ?? true}
                good={values.goodThreshold ?? ""}
                bad={values.badThreshold ?? ""}
              />
            ) : null}

            {type === "yes_no" ? (
              <div className="flex flex-col gap-2">
                <Label id="good-answer-label">Which answer is good?</Label>
                <Controller
                  control={control}
                  name="goodAnswer"
                  render={({ field: f }) => (
                    <Segmented
                      labelledBy="good-answer-label"
                      value={f.value}
                      onChange={f.onChange}
                      items={[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                        { value: "neutral", label: "Neither" },
                      ]}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  &quot;No is good&quot; suits things like &quot;needs repairs&quot;. &quot;Neither&quot; shows the answer without coloring it.
                </p>
              </div>
            ) : null}

            {type === "dropdown" ? (
              <div className="flex flex-col gap-3">
                <Label>Choices</Label>
                <ul className="flex flex-col gap-3">
                  {options.fields.map((item, index) => (
                    <li key={item.id} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Choice ${index + 1} name`}
                          autoComplete="off"
                          className="h-11 flex-1 text-base"
                          aria-invalid={errors.options?.[index]?.label ? true : undefined}
                          {...register(`options.${index}.label`)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          className="size-11 shrink-0"
                          onClick={() => options.remove(index)}
                          aria-label={`Remove choice ${index + 1}`}
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </div>
                      <FieldError message={errors.options?.[index]?.label?.message} />
                      <Controller
                        control={control}
                        name={`options.${index}.tone`}
                        render={({ field: f }) => (
                          <Segmented
                            label={`Choice ${index + 1} rating`}
                            value={f.value}
                            onChange={f.onChange}
                            items={TONES.map((t) => ({ value: t, label: TONE_LABEL[t], tone: t }))}
                          />
                        )}
                      />
                    </li>
                  ))}
                </ul>
                <FieldError message={errors.options?.root?.message ?? (typeof errors.options?.message === "string" ? errors.options.message : undefined)} />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 self-start"
                  onClick={() => options.append({ value: "", label: "", tone: "neutral" })}
                >
                  <PlusIcon aria-hidden /> Add choice
                </Button>
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangleIcon className="size-4 shrink-0" aria-hidden /> Heads up
                </p>
                {warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {confirmed ? <p className="font-medium">Tap Save again to confirm.</p> : null}
              </div>
            ) : null}
          </div>

          <SheetFooter className="flex-row gap-2 border-t p-4">
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1 text-base"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-12 flex-1 text-base" disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {saving ? "Saving…" : confirmed ? "Confirm & save" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function NumberSettings({
  control,
  register,
  errors,
  higherIsBetter,
  good,
  bad,
}: {
  control: ReturnType<typeof useForm<FieldFormValues>>["control"];
  register: ReturnType<typeof useForm<FieldFormValues>>["register"];
  errors: ReturnType<typeof useForm<FieldFormValues>>["formState"]["errors"];
  higherIsBetter: boolean;
  good: string;
  bad: string;
}) {
  const samples = sampleNumbers({ higherIsBetter, goodThreshold: good, badThreshold: bad });
  const goodN = good.trim() === "" ? null : Number(good);
  const badN = bad.trim() === "" ? null : Number(bad);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label id="direction-label">Which is better?</Label>
        <Controller
          control={control}
          name="higherIsBetter"
          render={({ field: f }) => (
            <Segmented
              labelledBy="direction-label"
              value={f.value ? "higher" : "lower"}
              onChange={(v) => f.onChange(v === "higher")}
              items={[
                { value: "higher", label: "Higher" },
                { value: "lower", label: "Lower" },
              ]}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="good-threshold">{higherIsBetter ? "Green at or above" : "Green at or below"}</Label>
          <Input
            id="good-threshold"
            inputMode="decimal"
            autoComplete="off"
            placeholder="optional"
            className="h-12 text-base"
            aria-invalid={errors.goodThreshold ? true : undefined}
            {...register("goodThreshold")}
          />
          <FieldError message={errors.goodThreshold?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bad-threshold">{higherIsBetter ? "Red at or below" : "Red at or above"}</Label>
          <Input
            id="bad-threshold"
            inputMode="decimal"
            autoComplete="off"
            placeholder="optional"
            className="h-12 text-base"
            aria-invalid={errors.badThreshold ? true : undefined}
            {...register("badThreshold")}
          />
          <FieldError message={errors.badThreshold?.message} />
        </div>
      </div>

      {samples.length > 0 ? (
        <div className="flex flex-col gap-2" aria-label="Preview">
          <p className="text-xs text-muted-foreground">Preview: how sample values will look</p>
          <ul className="flex flex-wrap gap-2">
            {samples.map((n) => (
              <li key={n}>
                <ColorChip rating={rateNumber(n, higherIsBetter, goodN, badN)}>{n}</ColorChip>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Anything between the two lines is yellow. Leave a line empty to never use that color.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">With no lines set, values are shown but never colored.</p>
      )}
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** A native <select>: reliable on phones (opens the OS picker) and 48px tall for touch. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-12 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

type SegmentedItem<V extends string> = { value: V; label: string; tone?: Tone };

/** One-tap choice between a few options. Radio semantics, 48px touch targets. */
function Segmented<V extends string>({
  value,
  onChange,
  items,
  label,
  labelledBy,
}: {
  value: V;
  onChange: (value: V) => void;
  items: SegmentedItem<V>[];
  label?: string;
  labelledBy?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className="grid auto-cols-fr grid-flow-col gap-2">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              "h-12 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? item.tone === "good"
                  ? "border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : item.tone === "bad"
                    ? "border-red-600 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                    : item.tone === "neutral"
                      ? "border-amber-600 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      : "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
