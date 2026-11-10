"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CloudIcon,
  CloudOffIcon,
  HelpCircleIcon,
  KeyRoundIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useOffline } from "@/components/offline/offline-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  connectivityText,
  describeEntryRow,
  describeIndicator,
  describeLastOutcome,
  formatClockTime,
  selectSheetEntries,
  type IndicatorIcon,
} from "@/lib/offline-ui/sync-status";
import { cn } from "@/lib/utils";

const SIGN_IN_HREF = "/login";

function IndicatorGlyph({ icon, className }: { icon: IndicatorIcon; className?: string }) {
  const props = { className: cn("size-4 shrink-0", className), "aria-hidden": true } as const;
  switch (icon) {
    case "online":
      return <CloudIcon {...props} />;
    case "offline":
      return <CloudOffIcon {...props} />;
    case "unknown":
      return <HelpCircleIcon {...props} />;
    case "syncing":
      return <Loader2Icon {...props} className={cn(props.className, "animate-spin")} />;
    case "auth":
      return <KeyRoundIcon {...props} />;
    case "attention":
      return <AlertTriangleIcon {...props} />;
  }
}

function useIndicator() {
  const { snapshot, connectivity } = useOffline();
  const indicator = describeIndicator({
    ready: snapshot.ready,
    connectivity,
    counts: snapshot.counts,
    pausedForAuth: snapshot.pausedForAuth,
    syncing: snapshot.syncing,
    persistent: snapshot.persistent,
  });
  return { indicator, snapshot, connectivity };
}

/**
 * The always-visible sync indicator in the header: connection state, how many entries are waiting or failed,
 * and a spinner while syncing. Each state has an icon AND words (never color alone). Tapping it opens the
 * details sheet. The sr-only region announces changes politely to screen readers.
 */
export function SyncStatusChip() {
  const { indicator } = useIndicator();
  const [open, setOpen] = useState(false);
  const urgent = indicator.needsSignIn || indicator.failed > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "flex h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
          urgent && "border-amber-500/60 bg-amber-500/10",
        )}
      >
        <IndicatorGlyph icon={indicator.icon} />
        <span className="sm:hidden">{indicator.shortLabel}</span>
        <span className="hidden sm:inline">{indicator.label}</span>
        <span className="sr-only">. Open sync details.</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {indicator.announcement}
      </span>
      <SyncDetailsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * A strip under the header for the two states that need the scout to DO something now: the session expired
 * (sync is paused until they sign in again) and this browser cannot keep scouting on the device.
 * Renders nothing otherwise.
 */
export function SyncAttentionBanner() {
  const { indicator } = useIndicator();
  const { resumeAfterSignIn, snapshot } = useOffline();
  const [retrying, setRetrying] = useState(false);

  if (!indicator.needsSignIn && !indicator.storageWarning) return null;

  async function tryAgain() {
    setRetrying(true);
    try {
      await resumeAfterSignIn();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm">
      {indicator.needsSignIn ? (
        <>
          <p className="flex items-start gap-2 font-medium">
            <KeyRoundIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Your session expired. Nothing was lost: {snapshot.counts?.unsynced ?? 0} saved on this device will sync after you
            sign in again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              render={<a href={SIGN_IN_HREF} target="_blank" rel="noreferrer" />}
              className="h-11 px-4"
              nativeButton={false}
            >
              Sign in again (opens a new tab)
            </Button>
            <Button type="button" variant="outline" className="h-11 gap-2 px-4" onClick={() => void tryAgain()} disabled={retrying}>
              {retrying ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
              I&apos;ve signed in, try again
            </Button>
          </div>
        </>
      ) : null}
      {indicator.storageWarning ? (
        <p className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {indicator.storageWarning}
        </p>
      ) : null}
    </div>
  );
}

function SyncDetailsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { indicator, snapshot, connectivity } = useIndicator();
  const { syncNow, resumeAfterSignIn } = useOffline();
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => selectSheetEntries(snapshot.entries).map(describeEntryRow), [snapshot.entries]);
  const lastSync = formatClockTime(snapshot.lastSyncAt);
  const outcomeText = describeLastOutcome(snapshot.lastOutcome);
  const working = busy || snapshot.syncing;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Sync status</SheetTitle>
          <SheetDescription>
            Scouting is saved on this device first, then sent to the team when there is a connection.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border p-2.5">
              <dt className="text-xs text-muted-foreground">Connection</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <IndicatorGlyph icon={connectivity} /> {connectivityText(connectivity)}
              </dd>
            </div>
            <div className="rounded-lg border p-2.5">
              <dt className="text-xs text-muted-foreground">Last synced</dt>
              <dd className="font-medium">
                {lastSync ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2Icon className="size-4 shrink-0" aria-hidden /> {lastSync}
                  </span>
                ) : (
                  "Not yet"
                )}
              </dd>
            </div>
          </dl>

          {indicator.storageWarning ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {indicator.storageWarning}
            </p>
          ) : null}

          {indicator.needsSignIn ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <KeyRoundIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                Your session expired. Your scouting is safe on this device and will sync after you sign in again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  render={<a href={SIGN_IN_HREF} target="_blank" rel="noreferrer" />}
                  className="h-11 px-4"
                  nativeButton={false}
                >
                  Sign in again (opens a new tab)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2 px-4"
                  onClick={() => void run(resumeAfterSignIn)}
                  disabled={working}
                >
                  {working ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
                  I&apos;ve signed in, try again
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              className="h-12 gap-2 text-base"
              onClick={() => void run(syncNow)}
              disabled={working || !snapshot.ready}
            >
              {working ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
              {working ? "Syncing…" : "Sync now"}
            </Button>
          )}

          {outcomeText && !indicator.needsSignIn ? (
            <p role="status" className="text-sm text-muted-foreground">
              {outcomeText}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
              Nothing is waiting. Everything you scouted is synced.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Entries on this device that need attention">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/teams/${row.teamNumber}`}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex min-h-11 items-center font-semibold tabular-nums underline-offset-2 hover:underline"
                    >
                      Team {row.teamNumber}
                    </Link>
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs font-medium",
                        row.tone === "error" && "text-destructive",
                        row.tone === "warning" && "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {row.tone === "error" ? <AlertTriangleIcon className="size-3.5" aria-hidden /> : null}
                      {row.statusText}
                    </span>
                  </div>
                  {row.errorText ? <p className="text-muted-foreground">{row.errorText}</p> : null}
                  {row.attemptsText ? <p className="text-xs text-muted-foreground">{row.attemptsText}</p> : null}
                  {row.supersededNote ? <p className="text-xs text-muted-foreground">{row.supersededNote}</p> : null}
                  {row.canRetry ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-fit gap-2 px-4"
                      onClick={() => void run(syncNow)}
                      disabled={working || indicator.needsSignIn}
                    >
                      <RefreshCwIcon aria-hidden /> Retry
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
