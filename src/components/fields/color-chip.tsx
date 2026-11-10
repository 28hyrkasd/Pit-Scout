import { CheckIcon, CircleDashedIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Rating } from "@/lib/fields/types";

/**
 * Color is never the only signal: each rating also has its own icon and a text
 * label for screen readers. About 1 in 12 men cannot tell red from green, and
 * scouts read phones in bright arena light, so a colored dot alone is not enough.
 */
const STYLES: Record<Rating, { label: string; className: string; Icon: typeof CheckIcon }> = {
  good: {
    label: "Good",
    className: "bg-emerald-100 text-emerald-900 ring-emerald-600/30 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-500/40",
    Icon: CheckIcon,
  },
  neutral: {
    label: "Okay",
    className: "bg-amber-100 text-amber-900 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-500/40",
    Icon: MinusIcon,
  },
  bad: {
    label: "Bad",
    className: "bg-red-100 text-red-900 ring-red-600/30 dark:bg-red-950 dark:text-red-200 dark:ring-red-500/40",
    Icon: XIcon,
  },
  none: {
    label: "No data",
    className: "bg-muted text-muted-foreground ring-foreground/10",
    Icon: CircleDashedIcon,
  },
};

export function ratingLabel(rating: Rating) {
  return STYLES[rating].label;
}

type Props = {
  rating: Rating;
  /** The value to show next to the icon (e.g. "115 lbs"). Omit for an icon-only dot. */
  children?: React.ReactNode;
  className?: string;
};

export function ColorChip({ rating, children, className }: Props) {
  const { label, className: tone, Icon } = STYLES[rating];
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ring-1 ring-inset",
        tone,
        className,
      )}
      data-rating={rating}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {children ?? null}
      {/* The icon is decorative; this carries the meaning for assistive tech. */}
      <span className="sr-only">{`: ${label}`}</span>
    </span>
  );
}
