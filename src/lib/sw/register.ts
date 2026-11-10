import { PAGES_CACHE_PREFIX, STATIC_CACHE_NAME } from "./policy";

export const SW_URL = "/serwist/sw.js";

type RegisterOptions = {
  /** Called once when a new worker has installed and is waiting to take over. */
  onUpdateReady?: (applyUpdate: () => void) => void;
};

/**
 * Registers the service worker after the page has loaded (never blocks first paint).
 * Resolves to null when service workers are unavailable or the build is not production.
 *
 * Updates: a new worker installs in the background and waits. It is NOT activated
 * under an open page (that would swap assets while a scouting form is being edited);
 * `onUpdateReady` receives a function that activates it and reloads, for a user-driven
 * "Reload" prompt. Otherwise it takes over at the next launch.
 */
export async function registerServiceWorker(options: RegisterOptions = {}): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV !== "production") return null;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
    watchForUpdate(registration, options.onUpdateReady);
    return registration;
  } catch (error) {
    console.warn("Service worker registration failed; the app still works online.", error);
    return null;
  }
}

function watchForUpdate(registration: ServiceWorkerRegistration, onUpdateReady?: RegisterOptions["onUpdateReady"]) {
  if (!onUpdateReady) return;

  const announce = (worker: ServiceWorker) => {
    onUpdateReady(() => {
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      worker.postMessage({ type: "SKIP_WAITING" });
    });
  };

  // A worker may already be waiting (installed while a previous page was open).
  if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // `controller` is null on the very first install: nothing to update then.
      if (installing.state === "installed" && navigator.serviceWorker.controller) announce(installing);
    });
  });
}

/**
 * Deletes the cached page documents (and the runtime asset cache) from this browser.
 * Works from the page without the service worker running. Precached build assets are
 * kept: they contain no user data and the app needs them to boot. Does not touch
 * IndexedDB / localStorage (the offline data layer owns those).
 */
export async function clearPageCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const names = await caches.keys();
  const targets = names.filter((name) => name.startsWith(PAGES_CACHE_PREFIX) || name === STATIC_CACHE_NAME);
  await Promise.all(targets.map((name) => caches.delete(name)));
  return targets.length;
}
