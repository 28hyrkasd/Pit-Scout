import * as z from "zod";

/*
 * Two layers live here:
 *
 *  1. Upstream schemas: parse what TBA / Statbotics actually send. They only
 *     declare the fields we use and ignore the rest (z.object strips unknown
 *     keys by default), so an upstream field being added never breaks us.
 *     Fields that can be null in practice are modelled as nullable.
 *
 *  2. App schemas: the slim shapes our route handlers return to the browser,
 *     which Phase 8 also stores in IndexedDB. Keeping them small matters for
 *     offline storage and for the weak venue wifi.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** TBA event key, e.g. "2026casj". Same rule as the events.key CHECK constraint. */
export const eventKeySchema = z
  .string()
  .regex(/^[0-9]{4}[a-z0-9]+$/, { error: "Invalid event key" });

export const yearSchema = z.coerce
  .number()
  .int()
  .min(1992, { error: "Year must be 1992 or later" })
  .max(2100, { error: "Invalid year" });

export const teamNumberSchema = z.coerce.number().int().min(1).max(99999);

// ---------------------------------------------------------------------------
// TBA upstream
// ---------------------------------------------------------------------------

/**
 * Shape of /events/{year}/simple and /event/{key}/simple (the endpoints we use).
 * Verified against the live API: there is no `week` or `event_type_string` here
 * (those exist only on the full Event object).
 */
export const tbaEventUpstream = z.object({
  key: z.string(),
  name: z.string(),
  year: z.number().int(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  city: z.string().nullish(),
  state_prov: z.string().nullish(),
  country: z.string().nullish(),
});

export const tbaTeamUpstream = z.object({
  key: z.string(),
  team_number: z.number().int(),
  nickname: z.string().nullish(),
  name: z.string().nullish(),
  city: z.string().nullish(),
  state_prov: z.string().nullish(),
  country: z.string().nullish(),
  rookie_year: z.number().int().nullish(),
});

const wltRecord = z.object({
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
});

/** One row of /event/{key}/rankings. Rankings can be null for a future event. */
export const tbaRankingsUpstream = z
  .object({
    rankings: z.array(
      z.object({
        team_key: z.string(),
        rank: z.number().int(),
        record: wltRecord.nullish(),
        matches_played: z.number().int().nullish(),
        dq: z.number().int().nullish(),
      }),
    ),
  })
  .nullable();

/** /team/{key}/event/{event}/status. null when the team has no status yet. */
export const tbaTeamStatusUpstream = z
  .object({
    qual: z
      .object({
        num_teams: z.number().int().nullish(),
        ranking: z
          .object({
            rank: z.number().int().nullish(),
            record: wltRecord.nullish(),
            matches_played: z.number().int().nullish(),
          })
          .nullish(),
      })
      .nullish(),
    overall_status_str: z.string().nullish(),
    pit_location: z.string().nullish(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// Statbotics upstream
//
// `epa.breakdown` changes shape every game, so it is deliberately not modelled.
// ---------------------------------------------------------------------------

export const statboticsTeamEventUpstream = z.object({
  team: z.number().int(),
  epa: z
    .object({
      total_points: z.number().nullish(),
      unitless: z.number().nullish(),
      norm: z.number().nullish(),
      stats: z
        .object({
          start: z.number().nullish(),
          pre_elim: z.number().nullish(),
          mean: z.number().nullish(),
          max: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  record: z
    .object({
      qual: z
        .object({
          rank: z.number().int().nullish(),
          num_teams: z.number().int().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

// ---------------------------------------------------------------------------
// App schemas (what our route handlers return)
// ---------------------------------------------------------------------------

export const appEventSchema = z.object({
  key: z.string(),
  name: z.string(),
  year: z.number().int(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  city: z.string().nullable(),
  stateProv: z.string().nullable(),
  country: z.string().nullable(),
});
export type AppEvent = z.infer<typeof appEventSchema>;

export const appTeamSchema = z.object({
  teamNumber: z.number().int(),
  /** Display name. TBA nickname; falls back to "Team 254". */
  name: z.string(),
  city: z.string().nullable(),
  stateProv: z.string().nullable(),
  country: z.string().nullable(),
  /** Qualification rank at this event (TBA), if rankings exist yet. */
  rank: z.number().int().nullable(),
  record: z
    .object({ wins: z.number().int(), losses: z.number().int(), ties: z.number().int() })
    .nullable(),
});
export type AppTeam = z.infer<typeof appTeamSchema>;

/** Statbotics EPA for one team at one event. All numbers nullable: may not exist yet. */
export const appEpaSchema = z.object({
  teamNumber: z.number().int(),
  /** Expected points added (the headline number). */
  epa: z.number().nullable(),
  /** Event-level rank by EPA (1 = best), computed by us. */
  epaRank: z.number().int().nullable(),
});
export type AppEpa = z.infer<typeof appEpaSchema>;

/**
 * Standard envelope for every route handler response, so the client can always
 * tell "upstream failed" apart from "upstream has no data yet", and the UI can
 * keep working with scouting data only.
 */
export type Envelope<T> = {
  ok: boolean;
  data: T | null;
  error: string | null;
  fetchedAt: string;
};
