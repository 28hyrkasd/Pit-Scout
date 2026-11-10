"use client";

import { useEffect, useRef } from "react";

export const UNSAVED_MESSAGE =
  "You have unsaved changes. Leave without saving?";

/*
 * App-wide count of forms holding edits that exist only on screen. A forced redirect to
 * /login is a full page load, which would destroy them; read queries that hit an expired
 * session ask hasUnsavedChanges() first and stay put instead (see handleUnauthorized).
 * Edits already saved to this device are safe in IndexedDB and do not count.
 */
let dirtyForms = 0;

/** Register one dirty form; call the returned function when it is clean or gone. Idempotent per registration. */
export function registerUnsavedChanges(): () => void {
  dirtyForms += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dirtyForms -= 1;
  };
}

export function hasUnsavedChanges(): boolean {
  return dirtyForms > 0;
}

export type ClickInfo = {
  /** The anchor's fully resolved href (anchor.href), or null if the click was not on a link. */
  href: string | null;
  target: string | null;
  download: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

/**
 * Would this click navigate this tab to a different page of the app?
 *
 * Only those clicks should trigger the "unsaved changes" prompt. Opening in a new
 * tab (ctrl/cmd/middle click, target=_blank), downloads, same-page anchors and
 * links to other sites leave the form where it is, so prompting would be wrong.
 */
export function isLeavingClick(click: ClickInfo, currentUrl: string): boolean {
  if (click.defaultPrevented || click.href === null) return false;
  if (
    click.button !== 0 ||
    click.metaKey ||
    click.ctrlKey ||
    click.shiftKey ||
    click.altKey
  )
    return false;
  if (click.download) return false;
  if (click.target && click.target !== "_self") return false;

  let next: URL;
  let current: URL;
  try {
    next = new URL(click.href);
    current = new URL(currentUrl);
  } catch {
    return false;
  }
  if (next.origin !== current.origin) return false; // another site: the browser's beforeunload covers it
  // Same page (including a #hash jump) keeps the form on screen.
  return next.pathname + next.search !== current.pathname + current.search;
}

/**
 * Warn before the scout loses unsaved work:
 *  - closing/reloading the tab: the browser's native prompt (beforeunload);
 *  - tapping any in-app link: a confirm() before the router navigates.
 *
 * NOT covered: the browser/hardware Back button. The App Router offers no
 * supported way to intercept history traversal, so the form cannot stop it.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  // A ref so the listeners are attached once and always read the latest value.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => (dirty ? registerUnsavedChanges() : undefined), [dirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = ""; // required by some browsers to show the prompt
    };

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const leaving = isLeavingClick(
        {
          href: anchor instanceof HTMLAnchorElement ? anchor.href : null,
          target: anchor?.getAttribute("target") ?? null,
          download: anchor?.hasAttribute("download") ?? false,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        window.location.href,
      );
      if (leaving && !window.confirm(UNSAVED_MESSAGE)) {
        // Capture phase + stopPropagation: Next's <Link> handler never sees the click.
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}
