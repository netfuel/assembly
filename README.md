# Assembly

A map-first PWA for underground music: DIY shows, warehouse raves, queer dance nights, and small bars and clubs. Launch city is Memphis. Product requirements live in [docs/PRD.md](docs/PRD.md) (snapshot) and the [living PRD](https://claude.ai/artifact/1tFSZkf9n1XXcZHNf1gJgc).

## Stack

| Layer | Choice |
| --- | --- |
| App | React 19 + Vite 8, TypeScript, `vite-plugin-pwa` (Workbox) |
| Map | MapLibre GL 6, custom night style (`src/map/nightStyle.ts`), OpenFreeMap vector tiles |
| API | Hono on a Cloudflare Worker (`worker/`), served from the same deploy as the app |
| Data | D1 (SQLite) for events, venues, users, RSVPs; KV for sessions; R2 for flyers |
| Auth | Google and Apple OAuth via `arctic`, HTTP-only session cookie |

The app and API ship as one Cloudflare Worker with static assets: `/api/*` runs the Worker, everything else is the React app (with single-page fallback so `/e/<id>` links work).

## Run it locally

Requires Node 22+.

```sh
npm install
npm run setup:local   # creates the local D1 database and loads Memphis sample events
npm run dev           # http://localhost:5173 (app + API + local D1/KV/R2)
```

Sample event times are relative to when you seed. Run `npm run db:seed:local` again to refresh them.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests (time windows, labels) |
| `npm run typecheck` | Type-checks app, Worker, and config |
| `npm run build` | Production build into `dist/` |
| `npm run deploy` | Build and deploy to Cloudflare |

## Set up sign-in

Sign-in buttons stay disabled until the provider is configured. For local work copy `.dev.vars.example` to `.dev.vars` and fill it in; for production use `wrangler secret put <NAME>`.

**Google**
1. In Google Cloud Console, create an OAuth client of type "Web application".
2. Add authorized redirect URIs: `http://localhost:5173/api/auth/google/callback` and `https://<your-domain>/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Apple** (needs a paid Apple Developer account, and only works over HTTPS)
1. Create an App ID with "Sign in with Apple", then a Services ID; that Services ID is `APPLE_CLIENT_ID`.
2. Configure the Services ID with your domain and return URL `https://<your-domain>/api/auth/apple/callback`.
3. Create a Sign in with Apple key; note its Key ID (`APPLE_KEY_ID`) and your Team ID (`APPLE_TEAM_ID`).
4. Set `APPLE_PRIVATE_KEY` to the `.p8` contents (use `\n` for line breaks in `.dev.vars`).

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create assembly              # paste the database_id into wrangler.jsonc
npx wrangler kv namespace create SESSIONS    # paste the id into wrangler.jsonc
npx wrangler r2 bucket create assembly-media
npm run db:migrate:remote
npx wrangler secret put GOOGLE_CLIENT_ID     # and the other secrets above
```

Then set `APP_URL` in `wrangler.jsonc` to your production origin (for example `https://assembly.example`) and run `npm run deploy`. Don't load `db/seed.sql` in production; it's sample data.

## Project layout

```
db/            D1 migrations and local sample data
docs/          PRD snapshot
public/icons/  App icons (regenerate with python3 scripts/make-icons.py)
shared/        Types shared by app and API
src/app/       App shell, event sheet
src/components Base UI: Button, Chip, Sheet, Toast
src/lib/       API client, time windows (Memphis local time), calendar export
src/map/       MapLibre view and night style
src/styles/    Design tokens and base styles
worker/        Hono API: events, RSVPs, auth, sessions, media
```

## Design tokens

Colors, type, spacing, and motion live in `src/styles/tokens.css`. Sodium orange marks most events and the primary action; UV violet marks queer-centered events. Display type is Rubik Mono One, body is Figtree, and times and addresses use Space Mono. Fonts are self-hosted so the installed app works offline.

## Status

Foundations phase: schema, auth, design tokens, map, read-only event pages, RSVP. Posting (flyer upload, lineup builder with artist links, promo video up to 1:30 on Cloudflare Stream) is the Core build phase.
