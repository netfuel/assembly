# Assembly

A map-first PWA for underground music: DIY shows, warehouse raves, queer dance nights, and small bars and clubs. Launch city is Memphis. Product requirements live in [docs/PRD.md](docs/PRD.md) (snapshot) and the [living PRD](https://claude.ai/artifact/1tFSZkf9n1XXcZHNf1gJgc).

## Stack

| Layer | Choice |
| --- | --- |
| App | React 19 + Vite 8, TypeScript, `vite-plugin-pwa` (Workbox), GSAP, three.js, Timeless fonts |
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

## Fonts

Assembly is set in the [Timeless type family](https://timeless.co/type): Timeless Sans (Grotesk cut) for the interface and data, Timeless Serif for display and reading, and Timeless Serif Italic for decks. They're free for commercial use under the Timeless Free Font License, which allows embedding them in a website but **forbids putting the font files in a public repository**. So the files are gitignored and you add them locally:

1. Download the family from [timeless.co/type](https://timeless.co/type).
2. Copy these three variable fonts into `public/fonts/timeless/`:
   - `Sans-Grotesk/TimelessSansVF.woff2`
   - `Serif-Text/TimelessSerifVF.woff2`
   - `Serif-Text/TimelessSerifItalicVF.woff2`

Without them the app still runs on system fallbacks. `npm run deploy` checks for them first (`npm run check:fonts`) so production never ships without the real type. If you deploy from CI later, keep the files in private storage (for example a private R2 bucket) and copy them in during the build; never commit them.

Map labels use the tile host's Noto Sans glyphs. Using Timeless there would mean converting the fonts into map glyph files and hosting them, which the license doesn't allow.

## Design system

Structure heavily inspired by [save.design](https://save.design/), typography after the [Timeless specimen](https://timeless.co/type): a quiet monochrome interface in light (default) and dark themes, hairline frames with diamond nodes at the corners (`Frame`), a segmented time filter, small bordered tags, and one hot magenta accent (`--color-accent`) for the primary action, selection, and live states. Color comes from content: flyers, video, and map pins (UV violet for queer-centered events, sodium orange for everything else). Type is set editorially: serif display titles with a full stop, a serif-italic deck under each headline, Grotesk caps for time codes (`FRI 10 PM`), and issue-style counters (`N.01`). Generated flyers use Grotesk Black Italic.

**Themes.** Light is the default; dark is an explicit choice, remembered per device, toggled in the nav. Tokens for both live in `src/styles/tokens.css` under `[data-theme]`, and the basemap switches with them (`src/map/mapStyle.ts`).

Tokens live in `src/styles/tokens.css`; components in `src/components/ui.tsx`.

**Motion.** GSAP (`src/lib/motion.ts`) handles staggered reveals when sheets open and filters change, the rubber-stamp hit on RSVP, and count-ups. three.js renders the generated flyer for events without uploaded art (`src/components/FlyerShader.tsx`): domain-warped noise printed through a 4x4 ordered dither, seeded per event. It's lazy-loaded, pauses offscreen, and renders a single still frame when the viewer prefers reduced motion. Without WebGL it falls back to a CSS halftone.

## Status

Foundations phase: schema, auth, design tokens, map, read-only event pages, RSVP. Posting (flyer upload, lineup builder with artist links, promo video up to 1:30 on Cloudflare Stream) is the Core build phase.
