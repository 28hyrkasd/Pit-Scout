"use client";

import { useRef, useState } from "react";
import { LogOutIcon } from "lucide-react";
import { logout } from "@/app/login/actions";
import { useOffline } from "@/components/offline/offline-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOutWarning } from "@/lib/offline-ui/sign-out-guard";

/**
 * Sign out. If this device still holds scouting the server does not have, ask first (with the count): signing
 * out never deletes it (nothing here clears IndexedDB), but it cannot sync until someone signs in again.
 */
export function SignOutButton() {
  const { snapshot } = useOffline();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const warning = signOutWarning(snapshot.counts, snapshot.persistent);

  function onClick() {
    if (warning) setConfirming(true);
    else formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={logout}>
        <Button
          type="button"
          onClick={onClick}
          variant="ghost"
          size="icon-lg"
          className="size-11"
          aria-label="Sign out"
        >
          <LogOutIcon aria-hidden />
        </Button>
      </form>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{warning?.title}</DialogTitle>
            <DialogDescription>{warning?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" className="h-11 px-4" />}>{warning?.cancelLabel}</DialogClose>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
            >
              {warning?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
