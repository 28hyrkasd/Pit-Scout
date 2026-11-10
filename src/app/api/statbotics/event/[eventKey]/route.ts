import { badRequest, requireApiUser, respond } from "@/lib/external/route-helpers";
import { eventKeySchema } from "@/lib/external/schemas";
import { getEventEpa } from "@/lib/external/statbotics";

/**
 * GET /api/statbotics/event/2026casj  ->  EPA + EPA rank for every team at the event.
 * An event that has not started returns ok:true with an empty list (not an error).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/statbotics/event/[eventKey]">) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const { eventKey } = await ctx.params;
  const key = eventKeySchema.safeParse(eventKey);
  if (!key.success) return badRequest("Invalid event key.");

  return respond(await getEventEpa(key.data), 300);
}
