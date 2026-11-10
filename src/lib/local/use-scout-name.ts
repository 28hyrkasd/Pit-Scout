"use client";

import { useCallback, useSyncExternalStore } from "react";
import { normalizeScoutName } from "@/lib/entries/payload";
import {
  DEFAULT_SCOUT_NAME_STATE,
  loadScoutName,
  saveScoutName,
  SCOUT_NAME_STORAGE_KEY,
  type ScoutNameState,
} from "./scout-name";

/*
 * Same constraints as use-selected-event: useSyncExternalStore needs a stable
 * snapshot reference while the stored value is unchanged, and the server cannot
 * read localStorage, so the server snapshot is `null` ("not loaded yet"). That
 * lets the UI avoid flashing the first-launch prompt at someone who already
 * answered it.
 */
let cachedState: ScoutNameState = DEFAULT_SCOUT_NAME_STATE;
let cachedSignature: string | undefined;

/** Used only if localStorage refuses writes; wins over storage for this session. */
let memoryOverride: ScoutNameState | undefined;

function getSnapshot(): ScoutNameState {
  if (memoryOverride) return memoryOverride;
  const state = loadScoutName(window.localStorage);
  const signature = `${state.asked}|${state.name ?? ""}`;
  if (signature !== cachedSignature) {
    cachedSignature = signature;
    cachedState = state;
  }
  return cachedState;
}

const getServerSnapshot = (): ScoutNameState | null => null;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SCOUT_NAME_STORAGE_KEY || e.key === null) {
      memoryOverride = undefined;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The scout's saved name. `ready` is false until the browser has been read, so
 * callers can wait before deciding whether to show the first-launch prompt.
 */
export function useScoutName() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const save = useCallback((name: string | null) => {
    const saved = saveScoutName(window.localStorage, name);
    if (saved) {
      memoryOverride = undefined;
    } else {
      // Storage is blocked/full: remember it for this session at least.
      memoryOverride = { asked: true, name: normalizeScoutName(name) };
    }
    for (const listener of listeners) listener();
  }, []);

  /**
   * Record "skipped" unless an answer was saved in the meantime. Reads the CURRENT
   * stored value, not the one from the last render: when the dialog's own Save
   * button closes it, a stale `asked === false` would otherwise overwrite the
   * name that was just saved.
   */
  const skipIfUnasked = useCallback(() => {
    if (!getSnapshot().asked) save(null);
  }, [save]);

  return {
    ready: state !== null,
    asked: state?.asked ?? false,
    name: state?.name ?? null,
    save,
    skipIfUnasked,
  };
}
