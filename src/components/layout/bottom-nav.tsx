"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecksIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Teams", Icon: UsersIcon },
  { href: "/settings", label: "Fields", Icon: ListChecksIcon },
] as const;

/** Whether `href` is the current section. "/" only matches exactly, so it is not always active. */
export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/teams") : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <ul className="mx-auto flex max-w-2xl">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none transition-colors focus-visible:bg-muted",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
