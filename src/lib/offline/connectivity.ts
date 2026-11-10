/*
 * Connectivity that does not trust navigator.onLine.
 *
 * navigator.onLine only says "this device has a network interface up". On venue
 * wifi that is connected but has no working internet (or a captive portal) it
 * stays true while every request fails. So the monitor ACTIVELY PROBES a tiny
 * same-origin endpoint and applies hysteresis so one dropped packet does not
 * flap the UI between online and offline.
 */

export type ConnectivityStatus = "online" | "offline" | "unknown";

export type ConnectivityState = {
  status: ConnectivityStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
};

export type ConnectivityConfig = {
  /** Failures in a row before we say "offline". */
  failuresToOffline: number;
  /** Successes in a row before we say "online". */
  successesToOnline: number;
};

export const DEFAULT_CONNECTIVITY: ConnectivityConfig = {
  failuresToOffline: 2,
  successesToOnline: 1,
};

export const INITIAL_CONNECTIVITY: ConnectivityState = {
  status: "unknown",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
};

/**
 * probe-success / probe-failure: the result of an active probe.
 * browser-offline: the browser fired "offline". Counts as ONE failure (a hint),
 *   so it plus one failed probe flips quickly, but it alone does not.
 * browser-online: the browser fired "online". Never flips anything by itself
 *   (that is exactly the lie we don't trust); the monitor probes right away.
 */
export type ConnectivityEvent =
  | "probe-success"
  | "probe-failure"
  | "browser-offline"
  | "browser-online";

/** Pure reducer for the hysteresis. */
export function nextConnectivity(
  state: ConnectivityState,
  event: ConnectivityEvent,
  config: ConnectivityConfig = DEFAULT_CONNECTIVITY,
): ConnectivityState {
  switch (event) {
    case "probe-success": {
      const consecutiveSuccesses = state.consecutiveSuccesses + 1;
      return {
        status:
          consecutiveSuccesses >= config.successesToOnline
            ? "online"
            : state.status,
        consecutiveFailures: 0,
        consecutiveSuccesses,
      };
    }
    case "probe-failure":
    case "browser-offline": {
      const consecutiveFailures = state.consecutiveFailures + 1;
      return {
        // Hysteresis protects a connection we KNOW is up from flapping on one dropped packet. With nothing known
        // yet (app just opened) there is nothing to flap from, so a failed first check is already the answer:
        // waiting for a second one would leave the app on "Checking connection" for another probe interval.
        status:
          consecutiveFailures >= config.failuresToOffline || state.status === "unknown"
            ? "offline"
            : state.status,
        consecutiveFailures,
        consecutiveSuccesses: 0,
      };
    }
    case "browser-online":
      return state;
  }
}

export type ConnectivityMonitorOptions = {
  /** Injected so tests (and a service-worker-free fetch) can stand in. Usually `globalThis.fetch`. */
  fetch: (input: string, init: RequestInit) => Promise<Pick<Response, "ok">>;
  /**
   * Tiny, public, same-origin, never cached. Recommended: HEAD /api/health -> 204
   * with `Cache-Control: no-store`. It must NOT be precached or served from a
   * cache by the service worker (use NetworkOnly) or it will always "succeed".
   */
  probeUrl?: string;
  timeoutMs?: number;
  /** Re-probe period while online / while offline-or-unknown (faster, to notice recovery). */
  intervalOnlineMs?: number;
  intervalOfflineMs?: number;
  config?: Partial<ConnectivityConfig>;
  /** window (online/offline events) and document (visibilitychange); omit in tests that don't need them. */
  windowTarget?: EventTarget;
  documentTarget?: EventTarget & { visibilityState?: string };
  now?: () => number;
};

const DEFAULT_PROBE_URL = "/api/health";

/**
 * Framework-free connectivity store for useSyncExternalStore:
 *
 *   const status = useSyncExternalStore(m.subscribe, m.getSnapshot, m.getServerSnapshot);
 *
 * Call start() once (e.g. in an effect) and stop() on cleanup. Snapshots are
 * primitive strings, so React's equality check is stable.
 */
export class ConnectivityMonitor {
  private state: ConnectivityState = INITIAL_CONNECTIVITY;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private probing: Promise<ConnectivityStatus> | null = null;
  private readonly config: ConnectivityConfig;
  private readonly probeUrl: string;
  private readonly timeoutMs: number;
  private readonly intervalOnlineMs: number;
  private readonly intervalOfflineMs: number;

  constructor(private readonly options: ConnectivityMonitorOptions) {
    this.config = { ...DEFAULT_CONNECTIVITY, ...options.config };
    this.probeUrl = options.probeUrl ?? DEFAULT_PROBE_URL;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.intervalOnlineMs = options.intervalOnlineMs ?? 30_000;
    this.intervalOfflineMs = options.intervalOfflineMs ?? 8_000;
  }

  /** Arrow properties so they can be passed straight to useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConnectivityStatus => this.state.status;

  /** Server render and hydration: we know nothing. */
  getServerSnapshot = (): ConnectivityStatus => "unknown";

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.windowTarget?.addEventListener("online", this.onBrowserOnline);
    this.options.windowTarget?.addEventListener("offline", this.onBrowserOffline);
    this.options.documentTarget?.addEventListener("visibilitychange", this.onVisibility);
    void this.probeNow();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.options.windowTarget?.removeEventListener("online", this.onBrowserOnline);
    this.options.windowTarget?.removeEventListener("offline", this.onBrowserOffline);
    this.options.documentTarget?.removeEventListener("visibilitychange", this.onVisibility);
    this.clearTimer();
  }

  /**
   * Probe now (single-flight). Resolves with the status after the probe. Use it
   * when a request just failed ("did we really lose connection?") or on "Sync now".
   */
  probeNow(): Promise<ConnectivityStatus> {
    if (this.probing) return this.probing;
    this.clearTimer();
    const run = this.runProbe().finally(() => {
      this.probing = null;
      if (this.started) this.scheduleNext();
    });
    this.probing = run;
    return run;
  }

  private onBrowserOnline = () => {
    this.apply("browser-online");
    void this.probeNow();
  };

  private onBrowserOffline = () => {
    this.apply("browser-offline");
    void this.probeNow();
  };

  private onVisibility = () => {
    if (this.options.documentTarget?.visibilityState === "visible")
      void this.probeNow();
  };

  private async runProbe(): Promise<ConnectivityStatus> {
    const ok = await this.probeOnce();
    this.apply(ok ? "probe-success" : "probe-failure");
    return this.state.status;
  }

  /** One HEAD request that cannot hang: a timeout counts as failure, even if fetch ignores its AbortSignal. */
  private async probeOnce(): Promise<boolean> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, this.timeoutMs);
    });
    // Cache-buster + no-store: the probe must reach the network, not a cache.
    const stamp = (this.options.now ?? Date.now)();
    const url = `${this.probeUrl}${this.probeUrl.includes("?") ? "&" : "?"}t=${stamp}`;
    const request = Promise.resolve()
      .then(() =>
        this.options.fetch(url, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        }),
      )
      .then((res) => res.ok)
      .catch(() => false);
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private apply(event: ConnectivityEvent) {
    const next = nextConnectivity(this.state, event, this.config);
    const changed = next.status !== this.state.status;
    this.state = next;
    if (changed) for (const l of [...this.listeners]) l();
  }

  private scheduleNext() {
    this.clearTimer();
    // Confirm a suspected drop quickly (one failure so far) instead of waiting a full online interval.
    const settledOnline =
      this.state.status === "online" && this.state.consecutiveFailures === 0;
    const delay = settledOnline ? this.intervalOnlineMs : this.intervalOfflineMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.probeNow();
    }, delay);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
