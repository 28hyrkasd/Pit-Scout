# Pit Scout

Pit Scout is a mobile-first web app (installable as a PWA) for an FRC robotics team to scout **other teams' robots** in the pits at a competition. Scouts pick an event, walk the pits, and fill in a short, customizable form for each team (drivetrain, weight, auto, climb, notes, a 1-5 rating, photos). Event rosters come from [The Blue Alliance](https://www.thebluealliance.com/) and strength numbers (EPA) from [Statbotics](https://www.statbotics.io/), so you can see how a robot compares to everyone else at the event.

It is built for bad venue wifi. Offline support is still being built; see [Offline and PWA behaviour](#offline-and-pwa-behaviour).

Access model: the app is **invite-only**. Accounts are created by hand in the Supabase dashboard, public signup is disabled, and **everyone who can sign in can do everything**. There is no admin role.

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, `cacheComponents` and `partialPrefetching` enabled), React 19, TypeScript (strict)
- Tailwind CSS v4, shadcn/ui components on [Base UI](https://base-ui.com), `lucide-react` icons, `sonner` toasts, `next-themes` (light/dark)
- [Supabase](https://supabase.com): Postgres with row level security, Auth (email + password), private Storage bucket for photos. Browser and server clients via `@supabase/ssr`
- TanStack Query for client data fetching, `react-hook-form` + `zod` for forms and validation, `idb` and `browser-image-compression` for the offline/photo work
- Vitest for tests

> This Next.js version has breaking changes compared to older releases. See `AGENTS.md` and the docs shipped in `node_modules/next/dist/docs/` before changing framework-level code.

## Prerequisites

- **Node.js 20.9 or newer** (Next.js 16 requires `>=20.9.0`; `package.json` has no `engines` field of its own)
- npm (a `package-lock.json` is committed)
- **Docker** (Docker Desktop, OrbStack, etc.): the local Supabase stack runs in containers. The Supabase CLI is a dev dependency, so use `npx supabase ...`; there is nothing to install globally.
- A free [TBA Read API key](https://www.thebluealliance.com/account) (account page > Read API Keys > Add New Key)
- For deployment: a [Supabase](https://supabase.com) project and a [Vercel](https://vercel.com) account

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Start the local Supabase stack (needs Docker). First run pulls images.
#    This applies supabase/migrations/* and then supabase/seed.sql.
npx supabase start

# 3. Create your env file and fill it in (see "Environment variables")
cp .env.example .env.local
npx supabase status        # prints the API URL and the publishable key for .env.local

# 4. Create a user so you can sign in (see "Creating user accounts"); Studio is at http://127.0.0.1:54323

# 5. Run the app
npm run dev                # http://localhost:3000
```

Stop the local stack with `npx supabase stop`. Reset the local database to migrations + seed at any time with `npx supabase db reset` (this wipes local data, including local users).

Local Supabase ports come from `supabase/config.toml`: API `54321`, Postgres `54322`, Studio `54323`, local email-testing web UI `54324`.

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored). The template lists every variable the app reads.

| Variable | Scope | Required | Where to get it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (inlined into the browser bundle at build time) | Yes | Local: "API URL" from `npx supabase status`. Hosted: dashboard > Project Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Yes (or the legacy name below) | Local: `npx supabase status`. Hosted: dashboard > Project Settings > API Keys > Publishable key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | No | Legacy name for the same key. Only used when the publishable variable is unset |
| `TBA_API_KEY` | **Server-only secret** | Yes | https://www.thebluealliance.com/account > Read API Keys |

Notes:

- The public variables are validated in `src/lib/env.ts`, the server one in `src/lib/env.server.ts` (which imports `server-only`, so importing it from client code fails the build).
- `NEXT_PUBLIC_*` values are baked in at **build time**. After changing one on Vercel, redeploy.
- There is intentionally no Supabase service-role key. Do not add one.
- `npm run test:live` additionally reads `TBA_API_KEY` from `.env.local`. It sets `LIVE=1` itself.

## Creating user accounts

Signups are **disabled**: `enable_signup = false` in `supabase/config.toml`, so locally nobody can register themselves. Scouts are created by whoever manages the Supabase project:

1. Open the Supabase dashboard (hosted: your project; local: Studio at http://127.0.0.1:54323).
2. **Authentication > Users > Add user > Create new user**.
3. Enter the scout's email and a password, and tick **Auto Confirm User** so they can sign in immediately without an email round-trip.
4. Give them the email and password. They sign in at `/login`.

On the **hosted** project, signups are a dashboard setting, not read from `config.toml` unless you run `supabase config push`. Make sure it is off: **Authentication > Sign In / Providers** (older dashboards: Authentication > Providers > Email, or Authentication > Settings) > turn **"Allow new users to sign up" OFF**. Also keep **Allow anonymous sign-ins** off. Everyone who is signed in can read and write every table; do not create accounts for people you would not trust with that.

## Database and migrations

The schema lives in `supabase/migrations/` and is the source of truth. Tables: `events`, `field_definitions`, `scouting_entries`, `entry_photos`, plus the `upsert_scouting_entry` RPC and a private `robot-photos` storage bucket. Every table has RLS enabled, and every policy grants access to the `authenticated` role only (`anon` gets nothing).

Workflow for a schema change:

```bash
# 1. Create an empty, timestamped migration and write your SQL in it
npx supabase migration new add_something

# 2. Test it locally: this wipes the local DB and replays all migrations + seed.sql
npx supabase db reset

# 3. Regenerate TypeScript types (writes src/lib/database.types.ts; needs the local stack running)
npm run db:types

# 4. Run typecheck/lint/tests, get the migration reviewed

# 5. Only after review, apply to the hosted project
npx supabase link --project-ref <your-project-ref>   # once
npx supabase db push
```

Rules of thumb:

- Never edit a migration that has already been applied to the hosted database; add a new one.
- Never ship a destructive migration (`drop`, `truncate`, destructive `alter`) without explicit review.
- **Scouting fields are archived, not deleted** (`field_definitions.archived`), so keys inside `scouting_entries.answers` never dangle. Keep it that way in the UI and in SQL.
- `db:types` runs `prettier --write` on that one generated file only.

### Seed data

`supabase/seed.sql` is **local only**. It runs on `npx supabase db reset` (and on the first `supabase start`) and inserts 15 starter rows into `field_definitions` across the `specs`, `auto`, `endgame` and `other` sections (drivetrain, robot weight, programming language, climb level, can play defense, and so on). It creates no users, events or entries. All of these fields are editable or archivable on the Fields page in the app; none are hardcoded.

The **hosted database has no seed data, on purpose**: `supabase db push` only applies migrations, and `seed.sql` is not run against it. A team starts with an empty field list and builds its own on the Fields page (or deliberately runs the SQL once, which is a manual, opt-in step).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint (`eslint-config-next`, core-web-vitals + TypeScript) |
| `npm test` | Vitest, all tests once (`test:watch` for watch mode; `test:tz` runs the timezone-sensitive date formatting test under `America/Los_Angeles`) |
| `npm run test:live` | Opt-in integration test against the **real** TBA and Statbotics APIs (`LIVE=1`; needs `TBA_API_KEY` in `.env.local` and network). Skipped in normal `npm test` |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` from the local Supabase database |
| `node scripts/generate-icons.mjs` | Regenerate the app icons and favicon from one geometry definition (uses `sharp`, which ships with Next.js; outputs are committed, so only run this when changing the mark) |

## Project structure

```
src/
  proxy.ts                 Next.js proxy (middleware): refreshes the Supabase session on every
                           request and redirects signed-out users to /login. Its matcher skips
                           static/PWA assets (manifest, icons, service worker) so they load signed-out.
  app/
    layout.tsx             Root layout: fonts, theme, TanStack Query provider, toaster, PWA metadata
    manifest.ts            Web app manifest (served at /manifest.webmanifest)
    login/                 Sign-in page, server action, zod schema
    (app)/                 Signed-in shell (event switcher, bottom nav, user menu)
      page.tsx             Teams list for the selected event
      settings/            Scouting field editor ("Fields" tab)
      teams/[teamNumber]/  Per-team pages (currently the scouting entry editor at .../edit)
    api/                   Route handlers that proxy TBA and Statbotics (keys stay on the server)
  components/
    ui/                    shadcn/ui primitives
    entries/               Scouting form, field inputs, photo capture, scout-name prompt
    events/                Event picker / switcher
    fields/                Field definition editor and color chips
    layout/                Bottom nav, user menu
    teams/                 Team list and event roster preview
  lib/
    supabase/              Browser, server and proxy Supabase clients
    external/              TBA + Statbotics clients, zod schemas, ranking, caching/route helpers
    entries/               Entry payload building, validation, RPC wrapper, save flow, error classification
    fields/                Field types, parsing, formatting, good/neutral/bad color rules
    photos/                Client-side compression and Storage upload/signed URLs
    local/                 Per-device settings in localStorage (scout name, selected event)
    api/                   Typed client for our own route handlers + TanStack Query hooks
    teams/                 Merging TBA/Statbotics/scouting data per team
    auth.ts                getCurrentUser() / requireUser() (verifies the JWT with getClaims())
    env.ts, env.server.ts  Validated public and server-only environment
supabase/
  config.toml              Local stack config (signups off, ports)
  migrations/              Schema, RLS policies, storage bucket
  seed.sql                 Local-only starter fields
public/
  icons/                   App icons (SVG source + 192/512/maskable PNGs)
  apple-touch-icon.png
scripts/generate-icons.mjs Icon generator
```

Tests live next to the code they cover (`*.test.ts`). Server Actions and route handlers re-check the session themselves with `requireUser()`; the proxy redirect is not treated as a security boundary.

## Offline and PWA behaviour

<!-- OFFLINE:START -->

Pit Scout is built to keep working when venue wifi is slow or gone. Two separate layers do that:

- **The service worker** (this section) makes the app itself open and navigate offline.
- **The offline data layer** (`src/lib/offline`, see its README) keeps scouting data on the device in IndexedDB, queues saves and syncs them when the server is reachable again. The service worker never stores or syncs data.

### What the service worker caches

The worker is built with [Serwist](https://serwist.pages.dev) (`@serwist/turbopack`), bundled at build time from `src/app/sw.ts` and served at `/serwist/sw.js`. It is only registered in production builds, after the page has loaded.

| Request | Strategy | Notes |
| --- | --- | --- |
| Build assets: `/_next/static/*` (JS, CSS, fonts), icons, `manifest.webmanifest` | Precached at install | Fonts come from `next/font` and are self-hosted, so nothing is fetched from Google at runtime. |
| `/~offline` | Precached | Static page with no data and no account details. Shown when a page is not available offline. |
| Page navigations (`/`, `/settings`, `/teams/<n>`, `/teams/<n>/edit`) | Network first, 3 second timeout, then last good copy | Falls back to the saved copy after 3 s so "wifi up but dead" does not hang the app. A page with no saved copy gives up after 3 s (team pages, which reuse a saved team page) or 8 s (anything else, which shows `/~offline`). Only plain 200 HTML responses are stored. |
| `/api/*` (including the `/api/health` connectivity probe) | Network only | Never cached. |
| Supabase (`*.supabase.co`, including private signed photo URLs) | Network only | Never cached. |
| `/_next/image` | Network only | Can proxy signed URLs. |
| Next.js soft-navigation / prefetch (RSC) requests | Network only | Offline they fail fast and Next.js falls back to a normal page load, which the worker answers from cache. |
| `/login` | Network only | The sign-in page is never cached and never shown as the answer for an app route. |
| Server Actions (sign in / sign out) | Passed through | The page cache is cleared afterwards (see below). |

Pages you have opened stay available offline. Pages you have not opened work too, as long as they are a team page: one saved team page is reused for any team number (the number is swapped in the saved page), so tapping a team you have never opened still opens its scouting form. Anything else that is not saved shows `/~offline`.

### Who can see cached pages

The cached page HTML is rendered for the signed-in user and contains their email address (the account menu in the header). It contains no scouting data: that is loaded on the device by the client.

To keep one person's pages from being shown to the next person on a shared phone, cached pages are deleted when:

- anyone signs in or out (any Server Action finishes);
- an app page redirects (the session is gone or expired);
- a new version of the app activates;
- the user clears site data, or `clearPageCaches()` from `src/lib/sw/register.ts` runs.

Remaining limitation: if a session simply expires while the phone is offline and nobody signs out, the last user's cached pages (with their email in the header) are still shown until the phone is next online. Sign out on shared phones before handing them over. The scouting data itself is protected the same way as any other on-device data (see the offline data layer).

### How updates work

A new version is downloaded in the background and installed next to the running one. It does not take over under an open page, so a scouting form is never swapped mid-entry. Instead:

- an "Update available" toast offers a Reload button (it stays for 20 seconds); tapping it activates the new version and reloads;
- if you ignore it, the new version takes over the next time the app is closed and reopened.

The first install claims the page immediately, so the very first visit already works offline after one successful load. When a new version installs it also re-saves the home, settings and team pages so the first offline launch after an update still has pages to show (this needs the phone to be signed in and online during the update).

### Offline data: saving and syncing

- **Saving is local first.** Pressing Save writes the entry and its compressed photos to IndexedDB on the device, then starts a sync. The toast says "saved on this device" and only says "synced" once the server has accepted it.
- **Status.** The bar above the bottom navigation shows online or offline (it probes `/api/health`, it does not trust `navigator.onLine` alone), how many entries are waiting, and any that failed. Each entry is pending, syncing, synced or failed. "Sync now" retries immediately.
- **When it syncs.** On reconnecting, when the app regains focus, after each save, every 30 seconds while something is waiting, and on "Sync now". Failed network attempts back off (2 s doubling to 5 min). Nothing is ever discarded after retries.
- **Conflicts.** Last write wins by `updated_at`. If two scouts create the same team offline, the first row's id survives and photos are re-pointed to it; an older edit is marked "a newer version was already saved".
- **Expired session.** Syncing pauses with a "Sign in again" prompt. Queued data stays in IndexedDB and resumes after you sign in.
- **Cached reads.** Field definitions, team lists, ranks and EPA are cached on the device, so the team list opens offline, with a "Showing saved data from ..." note.
- **Shared phones.** IndexedDB belongs to the device, not the account. Unsynced entries left by one scout sync under whoever signs in next. Signing out warns you if entries are still waiting; sync before handing a phone over.

Details, state diagram and the idempotency argument are in `src/lib/offline/README.md`.

### Install and check it works

1. Open the app online, sign in and wait a few seconds on the home page.
2. Android (Chrome): menu, Install app. iOS (Safari): Share, Add to Home Screen.
3. Turn on airplane mode and open the app from the home screen. The home page, fields and any team page should open.

Offline checks during development need a production build, because the worker is not registered in `next dev`:

```bash
npm run build && npm run start
```

Then in Chrome DevTools: Application, Service Workers (it should show `/serwist/sw.js` as activated), and Network, Offline.

### How to clear it

- Settings of the browser or installed app: clear site data (this removes caches, local scouting data and queued saves, so sync first).
- Chrome DevTools, Application, Storage, Clear site data, and "Unregister" under Service Workers.
- In code: `clearPageCaches()` (`src/lib/sw/register.ts`) deletes cached pages and runtime assets and leaves scouting data alone; the worker also accepts a `CLEAR_PAGE_CACHES` message.

### Limits

- A page that was never saved and is not a team page shows the offline page until you are back online.
- Offline, the first launch after a deploy can only show pages that were re-saved at install (see above).
- Cached pages are a fallback: with a working connection the network wins, and after 3 seconds without an answer the saved copy is shown.
- Browsers can evict site data under storage pressure, and Safari clears the data of websites that were not added to the Home Screen after 7 days without use. Install the app and open it online before each event.
- `experimental.useOffline` from Next.js is intentionally not enabled: it is experimental, and the failed-prefetch fallback to a normal page load already gives the behaviour we need with the service worker.

<!-- OFFLINE:END -->

## Deploying to Vercel

1. Push the repository to GitHub (or another Git provider) and **Import Project** on Vercel.
2. Framework Preset: **Next.js** (auto-detected). Root Directory: the repository root (`./`). Leave the build command (`next build`), output directory and install command at their defaults.
3. Under **Environment Variables**, add all of these for **both Production and Preview**:
   - `NEXT_PUBLIC_SUPABASE_URL` (public)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public)
   - `TBA_API_KEY` (**server-only secret**; do not prefix it with `NEXT_PUBLIC_`)
   Never add a Supabase service-role key. Public variables are visible in the browser bundle by design; the publishable key is safe because RLS only allows signed-in users.
4. Deploy. The public variables are inlined at build time, so redeploy after changing them.
5. In Supabase: **Authentication > URL Configuration**. Set **Site URL** to your Vercel production domain (for example `https://pit-scout.vercel.app`) and add your Vercel domain(s) to **Redirect URLs** (include a wildcard such as `https://*-your-team.vercel.app/**` if you want preview deployments to work).
6. Confirm signups are off on the hosted project (see [Creating user accounts](#creating-user-accounts)) and create your scouts' accounts.
7. Apply database migrations to the hosted project (`npx supabase link` then `npx supabase db push`, after review).

The service worker and web manifest are served from the same origin over HTTPS on Vercel, which installability requires.

## Troubleshooting

- **"Invalid public environment" error on every page.** `NEXT_PUBLIC_SUPABASE_URL` is missing or not a URL, or the Supabase key is missing/too short (`src/lib/env.ts`). Check `.env.local` locally, or the Vercel env vars (Production vs Preview!), then restart `npm run dev` or redeploy; public variables are fixed at build time.
- **"Invalid server environment" / TBA data fails.** `TBA_API_KEY` is not set on the server. Add it to `.env.local` or Vercel and restart/redeploy.
- **Everything redirects to /login, or saves say your session expired (401).** The Supabase session expired or the cookie was cleared. Sign in again; the app keeps unsaved form data when a save fails with an expired session. API routes return a JSON `401` rather than a redirect so the client can tell "signed out" from "network down". If it happens right after deploying, check the Supabase Site URL / Redirect URLs and that the app is using the same Supabase project as the account.
- **Can't sign in with a freshly created user.** The user was probably created without **Auto Confirm User**. Confirm the user in Authentication > Users, or recreate it with the box ticked. Remember that signups are disabled, so "Sign up" cannot be used as a workaround.
- **Venue wifi is terrible or captive-portal wifi swallows requests.** Responses that are not the expected JSON are reported as "invalid"/network errors rather than crashing. Retry once on a better connection; the TBA/Statbotics lists are cached for a minute on the client (and longer on the server), and offline-first behaviour is described above (still in progress).
- **Photos do not show.** The `robot-photos` bucket is **private**; images are displayed through signed URLs that last one hour, so a stale tab shows broken images until the URLs are refreshed (reload). If they never load: confirm the `20261109025356_storage_photos` migration was applied to that project (the bucket and its `authenticated` policies must exist), that you are signed in, and that the object exists under `{event_key}/{team_number}/{photo_id}.jpg`. Uploads are limited to 5 MiB JPEG/PNG/WebP by the bucket.
- **Local Supabase will not start.** Make sure Docker is running and ports 54321-54324 are free. `npx supabase stop` and start again; `npx supabase db reset` rebuilds the local database.
- **Types out of date after a migration.** Run `npx supabase db reset` then `npm run db:types`.
