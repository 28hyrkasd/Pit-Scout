import { Suspense } from "react";
import type { Metadata } from "next";
import { EditorSkeleton, EntryEditor } from "@/components/entries/entry-editor";

export const metadata: Metadata = { title: "Scout a team" };

/**
 * `params` is a Promise in this version of Next.js, and with cacheComponents it must
 * be read inside a <Suspense> boundary. The page itself stays synchronous, so the
 * shell (header, nav, skeleton) is prerendered and the form streams in.
 */
export default function EditEntryPage({ params }: PageProps<"/teams/[teamNumber]/edit">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<EditorSkeleton />}>{params.then(({ teamNumber }) => <EntryEditor rawTeamNumber={teamNumber} />)}</Suspense>
    </div>
  );
}
