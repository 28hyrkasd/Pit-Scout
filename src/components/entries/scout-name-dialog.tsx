"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_SCOUT_NAME_LENGTH } from "@/lib/entries/form";
import { useScoutName } from "@/lib/local/use-scout-name";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Ask for (or change) the name saved on every entry as "scouted by". Optional. */
export function ScoutNameDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        {open ? <NameForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so the draft starts from the saved name each time.
function NameForm({ onDone }: { onDone: () => void }) {
  const { name, save } = useScoutName();
  const [draft, setDraft] = useState(name ?? "");

  function submit(next: string | null) {
    save(next);
    onDone();
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(draft);
      }}
    >
      <DialogHeader>
        <DialogTitle>Your name</DialogTitle>
        <DialogDescription>
          Saved with each team you scout so the team knows who to ask. It stays
          on this device. You can skip this.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="scout-name">Name (optional)</Label>
        <Input
          id="scout-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_SCOUT_NAME_LENGTH}
          autoComplete="given-name"
          enterKeyHint="done"
          className="h-12 px-3"
        />
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => submit(null)}
        >
          Skip
        </Button>
        <Button type="submit" className="h-12">
          Save name
        </Button>
      </DialogFooter>
    </form>
  );
}
