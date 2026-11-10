"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OfflineProvider } from "@/components/offline/offline-provider";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Venue wifi is bad. "offlineFirst" always attempts the first fetch (so an
        // HTTP/service-worker cached response can answer) and only pauses retries
        // while offline. "online" would refuse to even try when navigator.onLine
        // is false, and navigator.onLine is unreliable (wifi up, no internet).
        networkMode: "offlineFirst",
        // TBA / Statbotics data is slow-moving. Serve it as fresh for a minute so
        // switching screens does not refetch constantly.
        staleTime: 60_000,
        gcTime: 24 * 60 * 60_000,
        // Two quick retries, not the default three with long backoff: on bad wifi a
        // slow failure is worse than showing the cached data and a retry button.
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        // Refetching every time the tab regains focus would hammer the APIs and
        // burn battery; the OfflineProvider owns "sync on focus" and refetches entry queries after a sync.
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Same reasoning as queries: try right away instead of pausing forever while the app thinks it is
        // offline (a paused mutation would leave a button spinning with no way out). A failure shows its
        // error so the scout can retry. Scouting entries do not use mutations at all: they are saved to the
        // device and synced by the OfflineProvider.
        networkMode: "offlineFirst",
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  // Server: always a new client, so data is never shared between requests/users.
  if (isServer) return makeQueryClient();
  // Browser: reuse one client so React suspending during render cannot throw it away.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <OfflineProvider>{children}</OfflineProvider>
    </QueryClientProvider>
  );
}
