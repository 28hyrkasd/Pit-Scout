import { badRequest, requireApiUser, respond } from "@/lib/external/route-helpers";
import { eventKeySchema } from "@/lib/external/schemas";
import { getEventTeams } from "@/lib/external/tba";

/** GET /api/tba/event/2026casj/teams  ->  teams at the event, with TBA rank/record merged in. */
export async function GET(_request: Request, ctx: RouteContext<"/api/tba/event/[eventKey]/teams">) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const { eventKey } = await ctx.params;
  const key = eventKeySchema.safeParse(eventKey);
  if (!key.success) return badRequest("Invalid event key.");

  return respond(await getEventTeams(key.data), 120);
}
