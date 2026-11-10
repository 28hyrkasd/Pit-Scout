import type { SyncCounts } from "@/lib/offline/local";

export type SignOutWarning = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
};

/**
 * Should signing out ask first? Only when this device still holds scouting the server does
 * not have: signing out never deletes it (IndexedDB is not cleared), but it cannot sync
 * until someone signs in again, so the scout deserves to know.
 *
 * Returns null when there is nothing to warn about, or when the counts are not known yet.
 * `persistent: false` means the saves only live in this tab's memory: then signing out
 * (or closing the tab) really can lose them, and the text says so.
 */
export function signOutWarning(
  counts: Pick<SyncCounts, "unsynced"> | null,
  persistent: boolean,
): SignOutWarning | null {
  if (!counts || counts.unsynced <= 0) return null;
  const n = counts.unsynced;
  const entries = `${n} scouting ${n === 1 ? "entry" : "entries"}`;
  return {
    title: `${n} ${n === 1 ? "entry isn't" : "entries aren't"} synced yet`,
    body: persistent
      ? `${entries} saved on this device ${n === 1 ? "hasn't" : "haven't"} reached the server. Signing out won't delete ${n === 1 ? "it" : "them"}, but ${n === 1 ? "it" : "they"} won't sync until someone signs in on this device again.`
      : `${entries} ${n === 1 ? "is" : "are"} only kept in this browser tab's memory and ${n === 1 ? "hasn't" : "haven't"} reached the server. If you sign out and close the tab, ${n === 1 ? "it" : "they"} may be lost. Sync first if you can.`,
    confirmLabel: "Sign out anyway",
    cancelLabel: "Stay signed in",
  };
}
