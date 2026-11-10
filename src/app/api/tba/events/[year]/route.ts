import type { NextRequest } from "next/server";
import { searchEvents } from "@/lib/external/event-search";
import { badRequest, requireApiUser, respond } from "@/lib/external/route-helpers";
import { yearSchema } from "@/lib/external/schemas";
import { getEventsForYear } from "@/lib/external/tba";

/** GET /api/tba/events/2026?q=silicon  ->  events in that year matching q (max 25). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/tba/events/[year]">) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const { year: rawYear } = await ctx.params;
  const year = yearSchema.safeParse(rawYear);
  if (!year.success) return badRequest("Invalid year.");

  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (q.length > 100) return badRequest("Search is too long.");

  const result = await getEventsForYear(year.data);
  if (!result.ok) return respond(result, 0);
  return respond({ ok: true, data: searchEvents(result.data, q) }, 300);
}
