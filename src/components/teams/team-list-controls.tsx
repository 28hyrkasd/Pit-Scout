"use client";

import { ArrowDownIcon, ArrowUpIcon, FilterXIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ANY_RED,
  DEFAULT_OPTIONS,
  defaultDirection,
  directionLabel,
  fieldSortKey,
  type ListOptions,
  type SortKey,
} from "@/lib/teams/filter-sort";
import { SECTIONS, SECTION_LABELS, type FieldDefinition } from "@/lib/fields/types";
import { cn } from "@/lib/utils";

/*
 * Native <select>s on purpose: on a phone they open the OS picker (large touch
 * targets, no custom popup to get wrong), and they stay fast with thousands of
 * options, which a custom listbox would not.
 */
const CONTROL =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 md:text-sm";

type Props = {
  options: ListOptions;
  onChange: (next: ListOptions) => void;
  /** Active fields in display order. */
  fields: FieldDefinition[];
  shown: number;
  total: number;
};

function FieldOptions({ fields, valueOf }: { fields: FieldDefinition[]; valueOf: (f: FieldDefinition) => string }) {
  return (
    <>
      {SECTIONS.map((section) => {
        const inSection = fields.filter((f) => f.section === section);
        if (inSection.length === 0) return null;
        return (
          <optgroup key={section} label={SECTION_LABELS[section]}>
            {inSection.map((f) => (
              <option key={f.id} value={valueOf(f)}>
                {f.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

export function TeamListControls({ options, onChange, fields, shown, total }: Props) {
  const set = (patch: Partial<ListOptions>) => onChange({ ...options, ...patch });
  const filtered = options.query.trim() !== "" || options.redFilter !== null || options.unscoutedOnly;
  const DirectionIcon = options.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;

  function changeSort(sort: SortKey) {
    // A new key starts in its most useful direction (rank 1 first, best EPA first, ...).
    onChange({ ...options, sort, direction: defaultDirection(sort) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <label htmlFor="team-search" className="sr-only">
          Search teams by number or name
        </label>
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id="team-search"
          type="search"
          value={options.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Search team number or name"
          autoComplete="off"
          autoCorrect="off"
          maxLength={100}
          className={cn(CONTROL, "pr-11 pl-9")}
        />
        {options.query !== "" ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => set({ query: "" })}
            className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <XIcon className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="min-w-0">
          <label htmlFor="team-sort" className="sr-only">
            Sort teams by
          </label>
          <select
            id="team-sort"
            className={CONTROL}
            value={options.sort}
            onChange={(e) => changeSort(e.target.value as SortKey)}
          >
            <option value="teamNumber">Sort: Team number</option>
            <option value="rank">Sort: TBA rank</option>
            <option value="epa">Sort: Statbotics EPA</option>
            <option value="rating">Sort: Overall rating</option>
            {fields.length > 0 ? (
              <optgroup label="Sort by a field">
                {fields.map((f) => (
                  <option key={f.id} value={fieldSortKey(f.id)}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-1.5 px-3 text-sm"
          onClick={() => set({ direction: options.direction === "asc" ? "desc" : "asc" })}
          aria-label={`Sort order: ${directionLabel(options.sort, options.direction)}. Press to reverse.`}
        >
          <DirectionIcon aria-hidden />
          {directionLabel(options.sort, options.direction)}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="team-red" className="sr-only">
            Only show teams with a bad (red) answer in
          </label>
          <select
            id="team-red"
            className={CONTROL}
            value={options.redFilter ?? ""}
            onChange={(e) => set({ redFilter: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">Filter: no red filter</option>
            <option value={ANY_RED}>Red in any field</option>
            {/* Grouped by section like the form; option values are field ids. */}
            <FieldOptions fields={fields} valueOf={(f) => f.id} />
          </select>
        </div>
        <Button
          type="button"
          variant={options.unscoutedOnly ? "default" : "outline"}
          aria-pressed={options.unscoutedOnly}
          className="h-11 justify-start px-3 text-sm"
          onClick={() => set({ unscoutedOnly: !options.unscoutedOnly })}
        >
          {options.unscoutedOnly ? "Showing unscouted only" : "Unscouted only"}
        </Button>
      </div>

      <div className="flex min-h-11 items-center justify-between gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          {filtered ? `${shown} of ${total} teams` : `${total} teams`}
        </p>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 gap-1.5 px-3 text-sm"
            onClick={() => onChange({ ...DEFAULT_OPTIONS, sort: options.sort, direction: options.direction })}
          >
            <FilterXIcon aria-hidden /> Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
