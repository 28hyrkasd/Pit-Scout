"use client";

import { ScoutNameDialog } from "@/components/entries/scout-name-dialog";
import { useScoutName } from "@/lib/local/use-scout-name";

/**
 * First-launch prompt for the scout's name. Mounted once in the app layout.
 * Closing it any way (Skip, Escape, tapping outside) counts as an answer, so it
 * is never shown again; the name can still be changed from the entry form.
 */
export function ScoutNamePrompt() {
  const { ready, asked, skipIfUnasked } = useScoutName();
  return (
    <ScoutNameDialog
      open={ready && !asked}
      onOpenChange={(open) => !open && skipIfUnasked()}
    />
  );
}
