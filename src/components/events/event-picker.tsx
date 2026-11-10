"use client";

import { useEffect, useState } from "react";
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { saveEventToDatabase } from "@/lib/api/save-event";
import { ApiError } from "@/lib/api/client";
import { handleUnauthorized, useEventSearch } from "@/lib/api/queries";
import type { AppEvent } from "@/lib/external/schemas";
import { formatEventDates, formatEventLocation } from "@/lib/format-event";
import { useSelectedEvent } from "@/lib/local/use-selected-event";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const FIRST_YEAR = 2002;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The current calendar year, read only in the browser after mount.
 *
 * Reading the clock during render is rejected at build time under Cache
 * Components (the value would be frozen into the prerendered shell, giving the
 * wrong season after New Year). null until mounted; the picker is a closed sheet
 * until then, so nothing visible depends on it.
 */
function useCurrentYear(): number | null {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must read the clock after mount, not during render
    setYear(new Date().getFullYear());
  }, []);
  return year;
}

export function EventPicker({ open, onOpenChange }: Props) {
  const { event: selected, select } = useSelectedEvent();
  const thisYear = useCurrentYear();
  // Until the clock is read, fall back to the selected event's season (or a
  // placeholder that is replaced on mount). A user choice always wins.
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const currentYear = thisYear ?? selected?.year ?? 2026;
  const year = chosenYear ?? selected?.year ?? currentYear;
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const search = useEventSearch(year, debouncedQuery);

  useEffect(() => {
    if (search.error) handleUnauthorized(search.error);
  }, [search.error]);

  async function choose(event: AppEvent) {
    select(event);
    onOpenChange(false);
    setQuery("");
    const saved = await saveEventToDatabase(event);
    if (!saved) {
      toast.warning("Event selected. It will be saved to the team database when you're back online.");
    }
  }

  const stepYear = (delta: number) =>
    setChosenYear(Math.min(currentYear + 1, Math.max(FIRST_YEAR, year + delta)));
  const isSearching = search.isFetching && search.isPlaceholderData;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl p-0">
        <SheetHeader className="gap-3 p-4 pb-3">
          <SheetTitle>Choose an event</SheetTitle>
          <SheetDescription className="sr-only">Search FRC events by name, code or location.</SheetDescription>

          <div className="flex items-center justify-between gap-2" role="group" aria-label="Season">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              className="size-12"
              onClick={() => stepYear(-1)}
              disabled={year <= FIRST_YEAR}
              aria-label="Previous year"
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
            <span className="text-lg font-semibold tabular-nums" aria-live="polite">
              {year}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              className="size-12"
              onClick={() => stepYear(1)}
              disabled={year >= currentYear + 1}
              aria-label="Next year"
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>

          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Name, code or city"
              aria-label="Search events"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 pl-9 text-base"
            />
          </div>
        </SheetHeader>

        <div className="min-h-40 flex-1 overflow-y-auto overscroll-contain border-t" aria-busy={isSearching}>
          <Results
            search={search}
            selectedKey={selected?.key ?? null}
            onChoose={choose}
            hasQuery={debouncedQuery.length > 0}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Results({
  search,
  selectedKey,
  onChoose,
  hasQuery,
}: {
  search: ReturnType<typeof useEventSearch>;
  selectedKey: string | null;
  onChoose: (event: AppEvent) => void;
  hasQuery: boolean;
}) {
  if (search.isPending) {
    return (
      <ul className="divide-y" aria-label="Loading events">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex h-16 items-center px-4">
            <div className="flex w-full flex-col gap-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (search.isError && !search.data) {
    const offline = search.error instanceof ApiError && search.error.kind === "network";
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {search.error instanceof ApiError ? search.error.message : "Could not load events."}
        </p>
        {offline ? (
          <p className="text-xs text-muted-foreground">
            Events you have already opened stay available offline. Searching needs a connection.
          </p>
        ) : null}
        <Button type="button" variant="outline" className="h-11" onClick={() => search.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const events = search.data?.data ?? [];
  if (events.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {hasQuery ? "No events match that search." : "No events listed for this season yet."}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {events.map((event) => {
        const isSelected = event.key === selectedKey;
        const location = formatEventLocation(event);
        const dates = formatEventDates(event);
        return (
          <li key={event.key}>
            <button
              type="button"
              onClick={() => onChoose(event)}
              aria-current={isSelected ? "true" : undefined}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted active:bg-muted"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{event.name}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {dates ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarIcon className="size-3" aria-hidden />
                      {dates}
                    </span>
                  ) : null}
                  {location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPinIcon className="size-3" aria-hidden />
                      {location}
                    </span>
                  ) : null}
                  <span className="font-mono">{event.key}</span>
                </span>
              </span>
              {isSelected ? <CheckIcon className="size-5 shrink-0 text-primary" aria-label="Selected" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
