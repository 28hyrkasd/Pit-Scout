"use client";

import { CalendarSearchIcon } from "lucide-react";
import { EventTeamList } from "@/components/teams/event-team-list";
import { formatEventDates, formatEventLocation } from "@/lib/format-event";
import { useSelectedEvent } from "@/lib/local/use-selected-event";

/** Home screen body. Client component because the selected event lives in localStorage. */
export function HomeContent() {
  const { event } = useSelectedEvent();

  if (!event) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <CalendarSearchIcon className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Pick an event to start scouting</h1>
        <p className="text-sm text-muted-foreground">
          Use the button at the top to choose the event you are at. You can switch events any time.
        </p>
      </div>
    );
  }

  const meta = [formatEventDates(event), formatEventLocation(event)].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{event.name}</h1>
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      <EventTeamList eventKey={event.key} />
    </div>
  );
}
