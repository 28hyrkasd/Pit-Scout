import type { Metadata } from "next";
import { WifiOffIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

// Static, public, data-free document. The service worker precaches it and serves it
// when a page cannot be loaded and no cached copy exists. It contains no user data,
// so it is safe to serve to anyone using the device. src/proxy.ts leaves it public.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <WifiOffIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted-foreground">
        This page isn&apos;t saved on this device yet. Pages you have opened before still work offline, and anything you
        scout is saved on this device and syncs when you&apos;re back online.
      </p>
      {/* A plain anchor, not <Link>: a full document load makes the service worker serve the saved home page. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className={cn(buttonVariants({ size: "lg" }))}>
        Go to Pit Scout
      </a>
    </main>
  );
}
