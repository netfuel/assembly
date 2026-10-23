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

On a Mac, double-click `start-dev.command`. It installs dependencies when they change, sets up the local database on first run, keeps generated folders out of Dropbox sync, and starts the dev server. Or by hand:

```sh
npm install
npm run setup:local   # creates the local D1 database and loads Memphis sample events
npm run dev           # http://localhost:5173 (app + API + local D1/KV/R2), plus a Network URL for your phone
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

The production site is **https://assembly.rsvp**. The app and API ship as one Worker named `assembly`, and Cloudflare Workers Builds deploys it from GitHub on every push to `main`.

**One-time setup.** On a Mac, double-click `setup-cloudflare.command` (or run `npm run setup:cloudflare`). It signs you in to Cloudflare, creates or reuses the D1 database (`assembly`), KV namespace (`assembly-sessions`), and R2 bucket (`assembly-media`), writes their IDs into `wrangler.jsonc`, and applies the database migrations. Commit `wrangler.jsonc` afterward; the IDs aren't secret. Then add the sign-in secrets (`npx wrangler secret put GOOGLE_CLIENT_ID`, and the others under "Set up sign-in").

**Workers Builds settings.** In the Cloudflare dashboard (Workers & Pages > assembly > Settings > Build), the build command must be `npm run build` and the deploy command `npx wrangler deploy` (non-production branches: `npx wrangler versions upload`). The Cloudflare Vite plugin writes the deploy config during the build, so deploying without building fails with "The `assets` property … is missing the required `directory` property".

The site's own address is read from each request, so there's no URL to configure: sign-in redirects and the cross-site check work on localhost, preview URLs, and assembly.rsvp alike. Don't load `db/seed.sql` in production; it's sample data.

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

Assembly is set in the [Timeless type family](https://timeless.co/type): Timeless Sans (Grotesk cut) for the interface and data, Timeless Serif for display and reading, and Timeless Serif Italic for decks. They're free for commercial use under the Timeless Free Font License, which allows embedding them in a website but **forbids putting the font files in a public repository**. So they never go into git:

- **Production:** the fonts live in the private R2 bucket (`assembly-media`, under `fonts/timeless/`). The Worker serves them at `/fonts/timeless/...` only to requests from Assembly's own pages (`worker/fonts.ts`), so automatic Cloudflare builds get the real type with nothing in the repo. Upload or refresh them with `npm run fonts:upload` (also run by `setup-cloudflare.command`).
- **Local dev:** copy the three variable fonts from the [download](https://timeless.co/type) into `public/fonts/timeless/` (gitignored): `Sans-Grotesk/TimelessSansVF.woff2`, `Serif-Text/TimelessSerifVF.woff2`, `Serif-Text/TimelessSerifItalicVF.woff2`. The Worker falls back to these when R2 doesn't have them.

Without the files anywhere, the app runs on system fallbacks. The installed PWA caches the fonts after first load, so they work offline.

Map labels use the tile host's Noto Sans glyphs. Using Timeless there would mean converting the fonts into map glyph files and hosting them, which the license doesn't allow.

## Design system

Structure heavily inspired by [save.design](https://save.design/), typography after the [Timeless specimen](https://timeless.co/type): a quiet monochrome interface in light (default) and dark themes, hairline frames with diamond nodes at the corners (`Frame`), a segmented time filter, small bordered tags, and one hot magenta accent (`--color-accent`) for the primary action, selection, and live states. Color comes from content: flyers, video, and map pins (UV violet for queer-centered events, sodium orange for everything else). Type is set editorially: serif display titles with a full stop, a serif-italic deck under each headline, Grotesk caps for time codes (`FRI 10 PM`), and issue-style counters (`N.01`). Generated flyers use Grotesk Black Italic.

**Themes.** Light is the default; dark is an explicit choice, remembered per device, toggled in the nav. Tokens for both live in `src/styles/tokens.css` under `[data-theme]`, and the basemap switches with them (`src/map/mapStyle.ts`).

Tokens live in `src/styles/tokens.css`; components in `src/components/ui.tsx`.

**Motion.** GSAP (`src/lib/motion.ts`) handles staggered reveals when sheets open and filters change, the rubber-stamp hit on RSVP, and count-ups. three.js renders the generated flyer for events without uploaded art (`src/components/FlyerShader.tsx`): domain-warped noise printed through a 4x4 ordered dither, seeded per event. It's lazy-loaded, pauses offscreen, and renders a single still frame when the viewer prefers reduced motion. Without WebGL it falls back to a CSS halftone.

## Status

Foundations phase: schema, auth, design tokens, map, read-only event pages, RSVP. Posting (flyer upload, lineup builder with artist links, promo video up to 1:30 on Cloudflare Stream) is the Core build phase.
