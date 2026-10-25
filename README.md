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

**Test sign-in.** To try posting without setting up Google or Apple, put `DEV_LOGIN=1` in `.dev.vars` and restart. The sign-in sheet then shows a "Test sign-in" box that signs you in under any name. It only works on `localhost`; never set `DEV_LOGIN` in production.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests (time windows, form times, posting validation, redirects) |
| `npm run typecheck` | Type-checks app, Worker, and config |
| `npm run build` | Production build into `dist/` |
| `npm run deploy` | Build and deploy to Cloudflare |

## Set up sign-in

Each sign-in option appears once it's configured. For local work copy `.dev.vars.example` to `.dev.vars` and fill it in; for production use `wrangler secret put <NAME>`.

**Email code** (for anyone without Google or Apple)

People enter their email, get a 6-digit code, and they're in; the first time creates the account and asks for a name. Codes expire after 10 minutes, work once, and lock after 5 wrong tries. A verified email links to an existing Google or Apple account with the same address, so nobody ends up with two accounts.

1. Apply the database change once: `npx wrangler d1 migrations apply assembly --remote` (migration `0003_email_sign_in.sql`).
2. Upgrade to the Workers Paid plan if you haven't (Email Sending requires it).
3. In the Cloudflare dashboard go to Compute > Email Service > Email Sending > Onboard Domain and pick `assembly.rsvp`. Cloudflare adds the SPF, DKIM, and DMARC records.
4. Turn it on: `npx wrangler secret put EMAIL_FROM` and enter `hello@assembly.rsvp` (or another address on that domain). The email option appears on the sign-in sheet once this is set.

Locally, with `DEV_LOGIN=1`, the email option works without any of this: the code shows on screen and in the terminal.

If sign-up says `E_SENDER_DOMAIN_NOT_AVAILABLE`, the sender's domain isn't enabled for sending. Onboarding a subdomain (like `mail.assembly.rsvp`) only allows addresses on that subdomain. Double-click `check-email.command` to see what's enabled and turn on assembly.rsvp itself.

**Google**
1. In Google Cloud Console, create an OAuth client of type "Web application".
2. Add authorized redirect URIs: `https://assembly.rsvp/api/auth/google/callback`, `https://www.assembly.rsvp/api/auth/google/callback`, and `http://localhost:5173/api/auth/google/callback` for local work. The site root alone (`https://assembly.rsvp`) is not enough.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Apple** (needs a paid Apple Developer account, and only works over HTTPS)
1. Create an App ID with "Sign in with Apple", then a Services ID; that Services ID is `APPLE_CLIENT_ID`.
2. Configure the Services ID with your domain and return URL `https://<your-domain>/api/auth/apple/callback`.
3. Create a Sign in with Apple key; note its Key ID (`APPLE_KEY_ID`) and your Team ID (`APPLE_TEAM_ID`).
4. Set `APPLE_PRIVATE_KEY` to the `.p8` contents (use `\n` for line breaks in `.dev.vars`).

## Set up promo video (Cloudflare Stream)

Organizers can attach a promo video up to 1:30. The browser uploads it straight to Cloudflare Stream through a one-time URL the Worker requests with a 90-second cap, so large files never pass through the Worker. Until it's configured, the form says video isn't set up yet and everything else works.

1. In the Cloudflare dashboard, open Stream and enable it on the account (it's billed per minute stored and delivered).
2. Create an API token with the **Stream: Edit** permission for the account.
3. Set the secrets: `npx wrangler secret put CLOUDFLARE_ACCOUNT_ID` and `npx wrangler secret put STREAM_API_TOKEN`. Optionally set `STREAM_CUSTOMER_CODE` (the `customer-…` part of your Stream playback URLs) so players load from your own subdomain.

Files up to 200 MB are accepted. Longer videos are refused in the browser before upload, and Stream rejects anything over 1:30 regardless.

## Set up notifications (web push)

People who RSVP can turn on notifications. They hear about time and place changes and cancellations, plus a reminder an hour before doors (a cron trigger runs every 15 minutes; see `triggers` in `wrangler.jsonc`). The encryption and signing are implemented on Web Crypto in `worker/push.ts` and tested against the RFC 8291 example.

1. Generate keys once: `npm run push:keys`.
2. Locally, paste the three lines into `.dev.vars`. Chrome on `localhost` delivers real notifications.
3. Production: `npx wrangler secret put VAPID_PUBLIC_KEY`, then `VAPID_PRIVATE_KEY`, and optionally `VAPID_SUBJECT` (defaults to `mailto:hello@assembly.rsvp`).

Keep the keys: changing them means everyone has to turn notifications on again. On iPhone, web push only works after adding Assembly to the Home Screen (iOS 16.4+); the app says so where the toggle would be.

## Moderation

Moderators review reports, restore or remove hidden events, and give organizers the verified badge. They're listed by sign-in email in the `MODERATORS` setting, comma-separated:

- Production: `npx wrangler secret put MODERATORS` and enter, for example, `you@gmail.com,partner@icloud.com`. Use the email your Google or Apple sign-in uses.
- Locally: `MODERATORS=test-moderator@dev.localhost` in `.dev.vars`, then use the test sign-in with the name "Test Moderator".

Moderators get a "Review reports" button on their profile, can open hidden events, and see Verify on the organizer line of any event.

## Go live

Double-click `go-live.command` on your Mac (or run `node scripts/go-live.mjs`). It signs in to Cloudflare, applies database changes to the live database, and walks through each secret: notification keys (generated for you), moderators, the email sender, Google and Apple sign-in, and Stream. It asks before each step, skips what's already set, and ends with a list of the dashboard steps it can't do:

- Workers Paid plan and Email Sending for assembly.rsvp (email sign-in codes).
- Google OAuth client and consent screen, using https://assembly.rsvp/privacy and /terms.
- assembly.rsvp as a Custom domain on the Worker, if it isn't answering.
- Email Routing for hello@assembly.rsvp, the contact address in the policies.
- Web Analytics for cookieless visitor counts.

Run it again whenever you finish one of those.

## Imported events (WYXR)

Real listings come from WYXR 91.7 FM's [Memphis concert calendar](https://concert-calendar.wyxr.org/). Each imported event is credited to WYXR in its description and links to the venue or ticket page.

- `db/import/wyxr-<date>.json`: the export (titles, dates, times, venues, ticket links).
- `scripts/import-wyxr.py`: turns an export into `db/import/wyxr.sql`. It places each venue (addresses and coordinates are in the script), skips non-music listings (comedy, bingo, markets) and duplicate listings, converts times from Central, and tags scenes. Events with no listed start time default to 8 PM and say so.
- `import-events.command`: double-click to load `db/import/wyxr.sql` into the live database. Safe to repeat: events update in place, RSVPs are kept, and future WYXR events missing from a newer export are removed unless someone RSVP'd.

## Deploy to Cloudflare

The production site is **https://assembly.rsvp**. The app and API ship as one Worker named `assembly`, and Cloudflare Workers Builds deploys it from GitHub on every push to `main`.

**One-time setup.** On a Mac, double-click `setup-cloudflare.command` (or run `npm run setup:cloudflare`). It signs you in to Cloudflare, creates or reuses the D1 database (`assembly`), KV namespace (`assembly-sessions`), and R2 bucket (`assembly-media`), writes their IDs into `wrangler.jsonc`, and applies the database migrations. Commit `wrangler.jsonc` afterward; the IDs aren't secret. Then add the sign-in secrets (`npx wrangler secret put GOOGLE_CLIENT_ID`, and the others under "Set up sign-in").

**Workers Builds settings.** Cloudflare's default build runs `npm clean-install` and then `npx wrangler deploy` with no build step. `wrangler.jsonc` declares `"build": { "command": "npm run build" }` and `assets.directory`, so that one command builds and deploys the app with no dashboard changes. Local `npm run deploy` works the same way.

The site's own address is read from each request, so there's no URL to configure: sign-in redirects and the cross-site check work on localhost, preview URLs, and assembly.rsvp alike. Don't load `db/seed.sql` in production; it's sample data.

## Project layout

```
db/            D1 migrations and local sample data
docs/          PRD snapshot
public/icons/  App icons (regenerate with python3 scripts/make-icons.py)
shared/        Types shared by app and API
src/app/       App shell, event sheet, announcement form
src/components Base UI: Button, Chip, Sheet, Toast
src/lib/       API client, time windows (Memphis local time), calendar export, media prep
src/map/       MapLibre view, pin picker, light and dark styles
src/styles/    Design tokens and base styles
worker/        Hono API: events, posting, uploads, RSVPs, auth, sessions, fonts
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

Ready for live users once the go-live steps are done.

- Policies at /terms, /privacy, and /guidelines (operator Matt Ladner, hello@assembly.rsvp). Accounts are 18+; sign-in shows the consent line.
- A new organizer's first event waits for moderator approval; after one approval, or with a verified badge, posts go live right away.
- Shared event links unfurl with the flyer, title, date, and place.
- Security headers on everything (policy in worker/security.ts; `npm run headers` regenerates public/_headers), a crash screen, and browser errors in Workers Logs.
- Moderators see launch numbers against the PRD targets in the review queue.

- **Make an announcement**: flyer upload (resized in the browser, metadata such as GPS stripped, stored in R2), title and one-liner, date and times in Memphis time (an end before the start means the next morning), a listed venue or any address with a draggable pin, scenes and door policies, door price, ticket link, lineup builder with artist search and links per service, and promo video up to 1:30.
- New posts keep a draft on the device until they're posted.
- Hosts can edit or cancel. Cancelled events stay on the map, marked, so people who planned around them find out; edits more than 10 minutes after posting show an Updated tag.
- Anyone signed in can report an event or its organizer. Three different reporters hide an event until a moderator restores or removes it. Reports on people go to the review queue and never hide anything automatically.
- Profiles: name, photo, pronouns, bio, scenes, and links. Showing up on "who's going" lists is opt-in. Delete account removes the profile, RSVPs, photos, and events hosted alone.
- Sharing: copy link, native share, and a 1080x1920 story card with the flyer, date, and a QR code.
- Map filters include any date, not just the next two weeks.
- Promo video plays muted while it's on screen (waits for a tap with reduced motion).
- Saved events (going or interested) stay on the device, so the address, times, and lineup open offline.
- Notifications: changes, cancellations, and a reminder an hour before doors, once VAPID keys are set.
- Limits: 10 posts an hour, 30 flyer uploads an hour, 10 videos an hour per account.
- Address search uses Photon (OpenStreetMap data). If it's down, the form falls back to placing the pin by hand.
