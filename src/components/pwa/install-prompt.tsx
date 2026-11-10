"use client";

import { useState, useSyncExternalStore } from "react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dismissInstallOffer,
  getInstallOffer,
  getServerInstallOffer,
  promptInstall,
  subscribeInstallOffer,
} from "@/lib/pwa/install-store";

/**
 * A strip under the header offering to install the app on the home screen. Renders nothing once installed,
 * after "Not now" (for two weeks), or when the browser cannot install (see lib/pwa/install.ts).
 *  - Chrome / Edge / Samsung Internet: an "Install" button that opens the browser's own dialog.
 *  - iPhone / iPad: Safari has no install API, so it shows the two taps that do it.
 */
export function InstallPrompt() {
  const offer = useSyncExternalStore(subscribeInstallOffer, getInstallOffer, getServerInstallOffer);
  const [busy, setBusy] = useState(false);

  if (offer.kind === "none") return null;

  async function install() {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label="Install the app" className="flex items-start gap-3 border-b bg-muted/60 px-4 py-2 text-sm">
      <DownloadIcon className="mt-2.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
        {offer.kind === "native" ? (
          <>
            <p>Install Pit Scout on your phone to open it like an app, even with no wifi.</p>
            <div>
              <Button type="button" className="h-11 px-4" onClick={() => void install()} disabled={busy}>
                Install app
              </Button>
            </div>
          </>
        ) : (
          <p>
            To install Pit Scout, tap <ShareIcon className="inline size-4 align-text-bottom" aria-label="Share" /> in
            Safari, then choose <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <Button type="button" variant="ghost" className="size-11 shrink-0 p-0" onClick={dismissInstallOffer}>
        <XIcon aria-hidden />
        <span className="sr-only">Not now</span>
      </Button>
    </div>
  );
}
