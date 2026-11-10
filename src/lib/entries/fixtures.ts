import type {
  DropdownField,
  FieldDefinition,
  NumberField,
  TextField,
  YesNoField,
} from "@/lib/fields/types";

/** Shared test fixtures: one field of each type, with stable ids. Not imported by app code. */
export const weight: NumberField = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Weight (lbs)",
  section: "specs",
  type: "number",
  sortOrder: 0,
  archived: false,
  higherIsBetter: false,
  goodThreshold: 100,
  badThreshold: 120,
};

export const canClimb: YesNoField = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Can climb",
  section: "endgame",
  type: "yes_no",
  sortOrder: 0,
  archived: false,
  goodAnswer: true,
};

export const drivetrain: DropdownField = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Drivetrain",
  section: "specs",
  type: "dropdown",
  sortOrder: 1,
  archived: false,
  options: [
    { value: "swerve", label: "Swerve", tone: "good" },
    { value: "tank", label: "Tank", tone: "neutral" },
    { value: "other", label: "Other", tone: "bad" },
  ],
};

export const comments: TextField = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Auto strategy",
  section: "auto",
  type: "text",
  sortOrder: 0,
  archived: false,
};

export const archivedField: NumberField = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Old field",
  section: "other",
  type: "number",
  sortOrder: 0,
  archived: true,
  higherIsBetter: true,
  goodThreshold: null,
  badThreshold: null,
};

export const ACTIVE_FIELDS: FieldDefinition[] = [
  weight,
  drivetrain,
  comments,
  canClimb,
];
