import * as z from "zod";

/**
 * Field definitions as the app sees them: a strict discriminated union, so a
 * `number` field is guaranteed to have threshold settings and a `dropdown` is
 * guaranteed to have options. The database row type is looser (section/type are
 * plain strings, options is raw JSON) because Postgres CHECK constraints do not
 * become TypeScript types, so rows are converted with parseFieldRow().
 */

export const SECTIONS = ["specs", "auto", "endgame", "other"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  specs: "Specs",
  auto: "Autonomous",
  endgame: "Endgame",
  other: "Other",
};

export const FIELD_TYPES = ["number", "yes_no", "dropdown", "text"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  number: "Number",
  yes_no: "Yes / No",
  dropdown: "Dropdown",
  text: "Text",
};

export const TONES = ["good", "neutral", "bad"] as const;
export type Tone = (typeof TONES)[number];

/** What a color indicator can show. "none" = no data was entered (gray). */
export type Rating = Tone | "none";

export const optionSchema = z.object({
  /** Stable machine value stored in entries. Never changes once data exists. */
  value: z.string().min(1).max(60),
  /** What scouts see. Safe to rename. */
  label: z.string().min(1).max(60),
  tone: z.enum(TONES),
});
export type FieldOption = z.infer<typeof optionSchema>;

type Base = {
  id: string;
  name: string;
  section: Section;
  sortOrder: number;
  archived: boolean;
};

export type NumberField = Base & {
  type: "number";
  /** true: bigger is better (auto pieces). false: smaller is better (weight, climb time). */
  higherIsBetter: boolean;
  /** Reaching this (in the good direction) is green. null = never green. */
  goodThreshold: number | null;
  /** Reaching this (in the bad direction) is red. null = never red. */
  badThreshold: number | null;
};

export type YesNoField = Base & {
  type: "yes_no";
  /** true: "yes" is good. false: "no" is good. null: both answers are neutral. */
  goodAnswer: boolean | null;
};

export type DropdownField = Base & {
  type: "dropdown";
  options: FieldOption[];
};

export type TextField = Base & { type: "text" };

export type FieldDefinition = NumberField | YesNoField | DropdownField | TextField;

/** A value stored in scouting_entries.answers[fieldId]. */
export type AnswerValue = number | boolean | string | null;
export type Answers = Record<string, AnswerValue>;
