"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AppEvent } from "@/lib/external/schemas";
import {
  SELECTED_EVENT_STORAGE_KEY,
  parseSelectedEvent,
  serializeSelectedEvent,
} from "./selected-event";

/*
 * useSyncExternalStore requires getSnapshot to return the SAME reference while
 * the underlying value is unchanged, or React re-renders forever. JSON.parse
 * produces a new object every call, so we memoize on the raw string.
 */
let cachedRaw: string | null | undefined;
let cachedEvent: AppEvent | null = null;

/**
 * Used only when localStorage is unavailable or full (e.g. Safari private mode).
 * While set, it wins over whatever is (or isn't) in storage, so a selection still
 * works for the rest of the session. `undefined` means "no override".
 */
let memoryOverride: AppEvent | null | undefined;

function getSnapshot(): AppEvent | null {
  if (memoryOverride !== undefined) return memoryOverride;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SELECTED_EVENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEvent = parseSelectedEvent(raw);
  }
  return cachedEvent;
}

// The server cannot know what is in the browser's storage. Rendering null on
// both the server and the hydration pass avoids a mismatch; the real value
// arrives immediately after hydration.
const getServerSnapshot = (): AppEvent | null => null;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // "storage" fires when ANOTHER tab/window changes the value.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SELECTED_EVENT_STORAGE_KEY || e.key === null) {
      memoryOverride = undefined; // another tab changed it; storage is authoritative again
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function useSelectedEvent() {
  const event = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: AppEvent) => {
    try {
      window.localStorage.setItem(SELECTED_EVENT_STORAGE_KEY, serializeSelectedEvent(next));
      memoryOverride = undefined;
    } catch {
      memoryOverride = next;
    }
    emit();
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(SELECTED_EVENT_STORAGE_KEY);
      memoryOverride = undefined;
    } catch {
      memoryOverride = null;
    }
    emit();
  }, []);

  return { event, select, clear };
}
