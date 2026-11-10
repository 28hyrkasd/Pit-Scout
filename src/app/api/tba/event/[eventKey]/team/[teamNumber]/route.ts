import { badRequest, requireApiUser, respond } from "@/lib/external/route-helpers";
import { eventKeySchema, teamNumberSchema } from "@/lib/external/schemas";
import { getTeamEventStatus } from "@/lib/external/tba";

/** GET /api/tba/event/2026casj/team/254  ->  that team's rank, record and pit at the event. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/tba/event/[eventKey]/team/[teamNumber]">,
) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const { eventKey, teamNumber } = await ctx.params;
  const key = eventKeySchema.safeParse(eventKey);
  const team = teamNumberSchema.safeParse(teamNumber);
  if (!key.success || !team.success) return badRequest("Invalid event key or team number.");

  return respond(await getTeamEventStatus(team.data, key.data), 120);
}
