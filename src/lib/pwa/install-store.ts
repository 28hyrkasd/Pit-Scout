import {
  decideOffer,
  isDismissed,
  isIosDevice,
  isStandalone,
  rememberDismissed,
  type BeforeInstallPromptEvent,
  type InstallOffer,
} from "./install";

/*
 * Browser-side state for the install offer, shaped for useSyncExternalStore. It lives at module level (not in a
 * component) because `beforeinstallprompt` can fire before React has mounted anything: the listener is attached as
 * soon as this module loads, and the component picks the event up whenever it renders.
 */

const NONE: InstallOffer = { kind: "none" };

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let dismissedNow = false;
let snapshot: InstallOffer = NONE;
let started = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function recompute() {
  if (typeof window === "undefined") return;
  const next = decideOffer({
    standalone: installed || isStandalone({
      matchMedia: window.matchMedia?.bind(window),
      navigator: navigator as Navigator & { standalone?: boolean },
    }),
    dismissed: dismissedNow || isDismissed(storage(), Date.now()),
    ios: isIosDevice(navigator),
    hasNativePrompt: deferred !== null,
  });
  // useSyncExternalStore compares by reference: keep the same object while nothing changed.
  if (next.kind === snapshot.kind) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // we show our own button instead of the browser's mini-infobar
    deferred = event as BeforeInstallPromptEvent;
    recompute();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    recompute();
  });
  recompute();
}

if (typeof window !== "undefined") start();

export function subscribeInstallOffer(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getInstallOffer = (): InstallOffer => snapshot;
export const getServerInstallOffer = (): InstallOffer => NONE;

/** Ask the browser to show its install dialog (only valid for the `native` offer, from a click). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  // The event can be used once.
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") installed = true;
    recompute();
    return outcome;
  } catch {
    recompute();
    return "unavailable";
  }
}

/** "Not now": hide the offer for a while. */
export function dismissInstallOffer(): void {
  dismissedNow = true;
  rememberDismissed(storage(), Date.now());
  recompute();
}
