"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { registerServiceWorker } from "@/lib/sw/register";

/**
 * Registers the service worker (production only, after load). Renders nothing.
 * When an update is ready it shows a toast; it never reloads on its own, so an
 * entry being edited is not lost. Ignoring the toast is fine: the update applies
 * the next time the app is launched.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker({
      onUpdateReady: (applyUpdate) => {
        toast("Update available", {
          id: "sw-update",
          description: "Reload when you've finished the entry you're working on.",
          duration: 20_000,
          action: { label: "Reload", onClick: applyUpdate },
        });
      },
    });
  }, []);

  return null;
}
