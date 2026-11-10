/*
 * "Install the app" support.
 *
 * Browsers decide for themselves whether to offer installation, and often do not (Chrome on Android only
 * sometimes shows its own prompt; Safari on iPhone never does). So the app offers it itself:
 *  - Chrome / Edge / Samsung Internet fire `beforeinstallprompt`; we keep the event and call prompt() from a button.
 *  - iOS has no such event, so we show the manual steps (Share, then Add to Home Screen).
 *
 * Installability itself (HTTPS, manifest, service worker) is covered by manifest.ts and the service worker.
 * None of it works on plain http:// (for example the dev server opened by LAN IP) or in `next dev`.
 */

/** The non-standard event Chromium browsers fire when the app can be installed. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallOffer = { kind: "none" } | { kind: "native" } | { kind: "ios" };

export const DISMISS_KEY = "pit-scout:install-dismissed-at";
/** After "Not now" the offer stays away this long. */
export const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

type Platform = { userAgent: string; platform?: string; maxTouchPoints?: number };

/** iPhone, iPod and iPad (iPadOS 13+ pretends to be a Mac, but has a touch screen). */
export function isIosDevice({ userAgent, platform, maxTouchPoints }: Platform): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && (maxTouchPoints ?? 0) > 1;
}

type StandaloneEnv = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
};

/** Already running as an installed app (so there is nothing to offer). */
export function isStandalone(env: StandaloneEnv): boolean {
  if (env.navigator?.standalone === true) return true; // iOS Safari
  return env.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function isDismissed(store: KeyValueStore | null, now: number): boolean {
  try {
    const raw = store?.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export function rememberDismissed(store: KeyValueStore | null, now: number): void {
  try {
    store?.setItem(DISMISS_KEY, String(now));
  } catch {
    // Storage blocked or full: the offer just comes back next visit.
  }
}

/** What to offer right now. `native` needs a captured `beforeinstallprompt` event. */
export function decideOffer(args: {
  standalone: boolean;
  dismissed: boolean;
  ios: boolean;
  hasNativePrompt: boolean;
}): InstallOffer {
  if (args.standalone || args.dismissed) return { kind: "none" };
  if (args.hasNativePrompt) return { kind: "native" };
  if (args.ios) return { kind: "ios" };
  return { kind: "none" };
}
