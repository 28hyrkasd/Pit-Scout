import type { Metadata } from "next";
import { SettingsFields } from "@/components/fields/settings-fields";

export const metadata: Metadata = { title: "Fields" };

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Scouting fields</h1>
        <p className="text-sm text-muted-foreground">
          The questions scouts answer for each team, and what counts as good or bad. Changing a color rule recolors
          existing data right away.
        </p>
      </div>
      <SettingsFields />
    </div>
  );
}
