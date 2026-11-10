"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { entryKey, type LocalEntry, type LocalPhoto } from "@/lib/offline/types";
import { useOffline } from "@/components/offline/offline-provider";

/** The device's own records for one event: live, straight from the sync snapshot (no extra IndexedDB reads). */
export function useLocalEntries(eventKey: string | null): { ready: boolean; entries: LocalEntry[] } {
  const { snapshot } = useOffline();
  const entries = useMemo(
    () => (eventKey === null ? [] : snapshot.entries.filter((e) => e.eventKey === eventKey)),
    [snapshot.entries, eventKey],
  );
  // version 0 = the first read of the store has not finished yet.
  return { ready: snapshot.ready && snapshot.version > 0, entries };
}

/** The device's record for one team, if any. */
export function useLocalEntry(
  eventKey: string | null,
  teamNumber: number,
): { ready: boolean; entry: LocalEntry | null } {
  const { snapshot } = useOffline();
  const entry = useMemo(
    () => (eventKey === null ? null : (snapshot.entries.find((e) => e.key === entryKey(eventKey, teamNumber)) ?? null)),
    [snapshot.entries, eventKey, teamNumber],
  );
  return { ready: snapshot.ready && snapshot.version > 0, entry };
}

/**
 * The device's photo records for one team (uploads waiting to go, queued removals), with object URLs for the blobs.
 * Reloads whenever the sync snapshot changes (a save, a pass). Object URLs are kept stable across reloads (no
 * flicker) and revoked when a photo goes away or the component unmounts.
 */
export function useLocalPhotos(eventKey: string | null, teamNumber: number) {
  const { store, snapshot } = useOffline();
  const key = eventKey === null ? "" : `${eventKey}:${teamNumber}`;
  const [loaded, setLoaded] = useState<{ key: string; photos: LocalPhoto[] } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const urlsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!store || eventKey === null) return;
    let cancelled = false;
    store
      .listPhotos({ eventKey, teamNumber })
      .then((photos) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const p of photos) {
          if (p.kind !== "upload" || !p.blob || p.status === "uploaded") continue;
          next.set(p.id, urlsRef.current.get(p.id) ?? URL.createObjectURL(p.blob));
        }
        for (const [id, url] of urlsRef.current) if (!next.has(id)) URL.revokeObjectURL(url);
        urlsRef.current = next;
        setPreviewUrls(next);
        setLoaded({ key, photos });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, photos: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [store, eventKey, teamNumber, key, snapshot.version]);

  useEffect(
    () => () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
      urlsRef.current = new Map();
    },
    [],
  );

  return {
    ready: loaded?.key === key,
    photos: loaded?.key === key ? loaded.photos : [],
    previewUrls,
  };
}
