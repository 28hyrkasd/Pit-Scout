import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectivityMonitor,
  INITIAL_CONNECTIVITY,
  nextConnectivity,
  type ConnectivityMonitorOptions,
  type ConnectivityStatus,
} from "./connectivity";

describe("nextConnectivity (pure hysteresis)", () => {
  const run = (events: Parameters<typeof nextConnectivity>[1][]) =>
    events.reduce((state, event) => nextConnectivity(state, event), INITIAL_CONNECTIVITY);

  it("starts unknown; one success flips to online", () => {
    expect(INITIAL_CONNECTIVITY.status).toBe("unknown");
    expect(run(["probe-success"]).status).toBe("online");
  });

  it("needs 2 consecutive failures to go offline; a success in between resets the count", () => {
    expect(run(["probe-success", "probe-failure"]).status).toBe("online");
    expect(run(["probe-success", "probe-failure", "probe-failure"]).status).toBe("offline");
    expect(run(["probe-success", "probe-failure", "probe-success", "probe-failure"]).status).toBe("online");
  });

  it("one success brings an offline device back online", () => {
    expect(run(["probe-failure", "probe-failure", "probe-success"]).status).toBe("online");
  });

  it("unknown + one failure is already offline (nothing known yet, so nothing to flap from)", () => {
    expect(run(["probe-failure"]).status).toBe("offline");
    expect(run(["browser-offline"]).status).toBe("offline");
  });

  it("the browser's 'offline' event is a hint worth one failure, not a verdict", () => {
    expect(run(["probe-success", "browser-offline"]).status).toBe("online");
    expect(run(["probe-success", "browser-offline", "probe-failure"]).status).toBe("offline");
  });

  it("the browser's 'online' event never flips anything by itself", () => {
    const offline = run(["probe-failure", "probe-failure"]);
    expect(nextConnectivity(offline, "browser-online")).toBe(offline);
    expect(run(["probe-failure", "probe-failure", "browser-online"]).status).toBe("offline");
  });

  it("thresholds are configurable", () => {
    const cfg = { failuresToOffline: 3, successesToOnline: 2 };
    let s = INITIAL_CONNECTIVITY;
    s = nextConnectivity(s, "probe-success", cfg);
    expect(s.status).toBe("unknown");
    s = nextConnectivity(s, "probe-success", cfg);
    expect(s.status).toBe("online");
    s = nextConnectivity(nextConnectivity(s, "probe-failure", cfg), "probe-failure", cfg);
    expect(s.status).toBe("online");
    expect(nextConnectivity(s, "probe-failure", cfg).status).toBe("offline");
  });
});

describe("ConnectivityMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T20:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Reply = "ok" | "fail" | "http-500" | "hang";
  function setup(overrides: Partial<ConnectivityMonitorOptions> = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    let reply: Reply = "ok";
    const windowTarget = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const monitor = new ConnectivityMonitor({
      fetch: (url, init) => {
        calls.push({ url, init });
        switch (reply) {
          case "ok":
            return Promise.resolve({ ok: true });
          case "http-500":
            return Promise.resolve({ ok: false });
          case "fail":
            return Promise.reject(new TypeError("Failed to fetch"));
          case "hang":
            return new Promise(() => {}); // ignores the AbortSignal on purpose
        }
      },
      windowTarget,
      documentTarget,
      ...overrides,
    });
    const statuses: ConnectivityStatus[] = [];
    monitor.subscribe(() => statuses.push(monitor.getSnapshot()));
    return {
      monitor,
      calls,
      statuses,
      windowTarget,
      documentTarget,
      setReply: (r: Reply) => (reply = r),
    };
  }

  it("probes on start: HEAD, same-origin, no-store, cache-busted; online after one success", async () => {
    const { monitor, calls } = setup();
    expect(monitor.getSnapshot()).toBe("unknown");
    expect(monitor.getServerSnapshot()).toBe("unknown");
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe("online");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/^\/api\/health\?t=\d+$/);
    expect(calls[0].init).toMatchObject({ method: "HEAD", cache: "no-store" });
    monitor.stop();
  });

  it("goes offline only after 2 consecutive failures, then recovers on the first success", async () => {
    const { monitor, setReply, statuses } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    setReply("fail");
    await vi.advanceTimersByTimeAsync(30_000); // next online probe: failure 1
    expect(monitor.getSnapshot()).toBe("online");
    await vi.advanceTimersByTimeAsync(8_000); // faster re-check after a failure: failure 2
    expect(monitor.getSnapshot()).toBe("offline");
    setReply("ok");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(monitor.getSnapshot()).toBe("online");
    expect(statuses).toEqual(["online", "offline", "online"]);
    monitor.stop();
  });

  it("a non-2xx response counts as a failed probe", async () => {
    const { monitor, setReply } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    setReply("http-500");
    await monitor.probeNow();
    await monitor.probeNow();
    expect(monitor.getSnapshot()).toBe("offline");
    monitor.stop();
  });

  it("a hanging request times out (even if fetch ignores AbortSignal) and counts as a failure", async () => {
    const { monitor, setReply, calls } = setup({ timeoutMs: 3_000 });
    setReply("hang");
    monitor.start();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(monitor.getSnapshot()).toBe("unknown");
    await vi.advanceTimersByTimeAsync(1);
    // the first check timed out: that is already "offline" (no waiting for a second one), signal was aborted
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(monitor.getSnapshot()).toBe("offline");
    monitor.stop();
  });

  it("the browser 'offline' event triggers an immediate probe: event + failed probe = offline right away", async () => {
    const { monitor, setReply, windowTarget, calls } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe("online");
    setReply("fail");
    windowTarget.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(monitor.getSnapshot()).toBe("offline");
    monitor.stop();
  });

  it("a lying 'offline' event does not take a working connection down", async () => {
    const { monitor, windowTarget } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    windowTarget.dispatchEvent(new Event("offline")); // probe succeeds
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe("online");
    monitor.stop();
  });

  it("the browser 'online' event probes immediately instead of trusting itself", async () => {
    const { monitor, setReply, windowTarget, calls } = setup();
    setReply("fail");
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await monitor.probeNow();
    expect(monitor.getSnapshot()).toBe("offline");
    setReply("fail");
    const before = calls.length;
    windowTarget.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(before + 1);
    expect(monitor.getSnapshot()).toBe("offline"); // the probe failed: still offline
    setReply("ok");
    windowTarget.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe("online");
    monitor.stop();
  });

  it("probes when the tab becomes visible again", async () => {
    const { monitor, documentTarget, calls } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    monitor.stop();
  });

  it("probes are single-flight", async () => {
    const { monitor, calls } = setup();
    const a = monitor.probeNow();
    const b = monitor.probeNow();
    expect(a).toBe(b);
    await a;
    expect(calls).toHaveLength(1);
  });

  it("subscribers are notified only when the status CHANGES; unsubscribe works; snapshots are primitive", async () => {
    const { monitor } = setup();
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1); // unknown -> online
    await vi.advanceTimersByTimeAsync(30_000); // another success: no change
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(monitor.getSnapshot()).toBe("online");
    monitor.stop();
  });

  it("stop() cancels polling and detaches listeners", async () => {
    const { monitor, windowTarget, calls } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    windowTarget.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(monitor.getSnapshot()).toBe("online");
  });

  it("start() twice does not double-poll", async () => {
    const { monitor, calls } = setup();
    monitor.start();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    monitor.stop();
  });

  it("polls every 30s while online", async () => {
    const { monitor, calls } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(3);
    monitor.stop();
  });

  it("a fetch that throws synchronously is just a failed probe", async () => {
    const monitor = new ConnectivityMonitor({
      fetch: () => {
        throw new Error("sync boom");
      },
    });
    await monitor.probeNow();
    await monitor.probeNow();
    expect(monitor.getSnapshot()).toBe("offline");
  });
});
