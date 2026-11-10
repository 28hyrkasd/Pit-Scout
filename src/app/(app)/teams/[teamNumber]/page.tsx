import { Suspense } from "react";
import type { Metadata } from "next";
import { TeamDetail, TeamDetailSkeleton } from "@/components/teams/team-detail";

export const metadata: Metadata = { title: "Team" };

/**
 * `params` is a Promise in this version of Next.js, and with cacheComponents it must
 * be read inside a <Suspense> boundary. The page stays synchronous so the shell
 * (header, nav, skeleton) is prerendered and the details stream in.
 */
export default function TeamDetailPage({ params }: PageProps<"/teams/[teamNumber]">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<TeamDetailSkeleton />}>{params.then(({ teamNumber }) => <TeamDetail rawTeamNumber={teamNumber} />)}</Suspense>
    </div>
  );
}
