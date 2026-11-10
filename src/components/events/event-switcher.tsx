"use client";

import { useState } from "react";
import { CalendarDaysIcon, ChevronDownIcon } from "lucide-react";
import { EventPicker } from "@/components/events/event-picker";
import { useSelectedEvent } from "@/lib/local/use-selected-event";

/** Header button: shows the current event, opens the picker. */
export function EventSwitcher() {
  const { event } = useSelectedEvent();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 min-w-0 max-w-[60%] items-center gap-2 rounded-lg border px-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-haspopup="dialog"
      >
        <CalendarDaysIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{event ? event.name : "Choose an event"}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <EventPicker open={open} onOpenChange={setOpen} />
    </>
  );
}
