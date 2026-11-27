# iOS app

Assembly's iPhone app is the same React build as the web app, packaged inside a native shell with
[Capacitor 8](https://capacitorjs.com/docs/ios). The plan, phases, and launch checklist live in the
"Assembly iOS app plan" doc; this file is how to build and run it.

| Thing | Where |
| --- | --- |
| Shell config | `capacitor.config.ts` (app ID `rsvp.assembly.app`, web build `dist/client`) |
| Xcode project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Native helpers in the web app | `src/lib/native.ts` |
| Worker side (CORS, write check, fonts) | `worker/appOrigin.ts` |
| Sign-in in the app | `src/lib/nativeAuth.ts`, `worker/appAuth.ts`, plugin in `native/assembly-auth` |
| Icon and launch image | `npm run ios:assets` (from `public/icons/favicon.svg`) |

Settings: iPhone only, portrait, iOS 16 and later, marked as using only exempt encryption (HTTPS), so TestFlight
uploads skip the export-compliance question.

## How it talks to the server

Inside the app the page runs at `capacitor://localhost`, so nothing is same-origin:

- API calls go to `https://assembly.rsvp/api/...` (`apiUrl()`), with cookies (`credentials: "include"`).
- Flyer and photo URLs in API responses (`/api/media/...`) are made absolute (`withServerUrls()`).
- The Timeless `@font-face` rules are re-pointed at `https://assembly.rsvp/fonts/...` (`pointFontsAtServer()`).
- The Worker answers CORS for `capacitor://localhost` only, and lets it past the cross-site write check.
- No service worker and no install prompt in the app.

On the web every helper is a no-op. Point a build at another server with `VITE_API_ORIGIN=https://... npm run ios:sync`.

## Links and sharing

- **Universal links.** `/.well-known/apple-app-site-association` lists event, artist, venue, organizer, city,
  invite and feed paths (`/e/*`, `/a/*`, `/v/*`, `/o/*`, `/c/*`, `/f/*`, `/feed`) under `applinks`, and the app has
  the `applinks:assembly.rsvp` entitlement, so tapping an assembly.rsvp link anywhere on the phone opens the app on
  it (`listenForUniversalLinks`, which also handles a cold launch).
- **Links inside the app** (`interceptAppLinks`): app pages route inside the app (through its history when it
  can); server files (`.ics`, feeds, downloads) open in Safari at assembly.rsvp. No other host loads in the app's
  web view.
- **Share** (`installNativeShare`): `navigator.share` / `canShare` go to iOS's share sheet (`@capacitor/share`),
  files written to the cache first (`@capacitor/filesystem`), so every Share button (links, story cards, flyers)
  works unchanged. Closing the sheet reads as `AbortError`, as on the web.
- Shared and subscribed URLs use `siteOrigin` (`https://assembly.rsvp`), never the app's `capacitor://localhost`.

## Signing in

The site's session cookie can't cross from `capacitor://localhost` to `https://assembly.rsvp`, so the app holds
the session token itself: in the keychain (this device only), sent as `Authorization: Bearer`. The server accepts
either the cookie or the Bearer token.

- **Email code:** `/api/auth/email/verify` answers the app's origin with `{ token }` instead of a cookie.
- **Google and Apple:** the app makes a PKCE verifier and opens `/api/auth/{google,apple}?app=<challenge>` in
  the system sign-in sheet (`ASWebAuthenticationSession`; Google refuses app web views). The usual round-trip
  runs; at the end the server stores a two-minute, one-use code tied to the challenge and sends the sheet to
  `rsvp.assembly.app://auth?signin=ok&code=…`. The app posts the code and verifier to `/api/auth/app/exchange`
  and gets the token. Waitlist and failure come back the same way, with no code.
- Every Google and Apple button is a plain link to `/api/auth/{provider}`, so `interceptSignInLinks()` catches
  them in one place; the gate and the sign-in sheet don't know they're in an app.
- Sign out and account deletion clear the keychain.

### Passkeys (Face ID)

Once signed in, Profile → Passkeys adds a passkey; next time "Sign in with a passkey" (sign-in sheet, and a
quiet link on the launch gate) signs in with Face ID or Touch ID. It's an addition to Google, Apple and email
code, and the gate still applies.

- The relying party is the site's host, `assembly.rsvp`, so one passkey works on the site and in the app. iCloud
  Keychain (or another password manager) syncs it to the person's other devices.
- On the web the browser's own prompt runs (`@simplewebauthn/browser`, loaded only when used). In the bundled app,
  Apple's passkey sheet runs through the plugin (`passkeyRegister`, `passkeySignIn`), WebAuthn JSON in and out,
  so the server checks both the same way (`worker/passkeys.ts`, `@simplewebauthn/server`).
- The app may use the site's passkeys because of the `webcredentials:assembly.rsvp` entitlement
  (`ios/App/App/App.entitlements`) and the site's `/.well-known/apple-app-site-association`, which lists
  `8F569K6WBX.rsvp.assembly.app`. Apple fetches that file through its CDN, which can take a while to pick up a change.
- Table `passkeys` (migration 0017); rows go with the account. Challenges are one-use, five minutes, in KV.

The native half is a small local plugin, `native/assembly-auth` (installed as `assembly-auth` from `file:`),
shaped like the official ones so `cap sync` adds it to the Swift package list. It has four calls:
`authenticate`, `getToken`, `setToken`, `clearToken`, `passkeyRegister`, `passkeySignIn`.

## One-time setup on the Mac

1. Install Xcode 26 from the Mac App Store (Apple requires Xcode 26 and the iOS 26 SDK for uploads). Open it once
   and let it install the iOS platform and a simulator.
2. `sudo xcode-select -s /Applications/Xcode.app` if `xcode-select -p` points somewhere else.
3. Node 22 or later (already needed for the web app).

## Run it in the simulator

```sh
git pull
npm ci
npm run ios:sync     # builds the web app and copies it into the Xcode project
npm run ios:open     # opens Xcode
```

In Xcode pick an iPhone simulator (iPhone 17, plus iPhone SE for the small screen) and press Run. The first
build downloads the Capacitor Swift packages, which takes a minute.

Run `npm run ios:sync` again after any web change, or use dev mode.

### Dev mode (live reload, full sign-in)

Point the app at `npm run dev` instead of the bundle. Everything is same-origin again, so the whole app works,
including the test sign-in (`DEV_LOGIN=1` in `.dev.vars`):

```sh
npm run dev                                                 # in one terminal
CAP_SERVER_URL=http://$(ipconfig getifaddr en0):5173 npx cap sync ios   # in another, then Run in Xcode
```

Before a TestFlight or App Store build, run a plain `npm run ios:sync` so the app ships the bundle, not a URL.

## Push notifications

The app gets the same notifications as web push: an event you saved changes or is cancelled, an hour before doors,
invites, friends checking in, and moderation news. They go through Apple (APNs) instead of the browser.

- **Server** (`worker/apns.ts`, `worker/push.ts`): `notifyUsers` sends to each person's web subscriptions and iPhones.
  The provider token is an ES256 JWT signed with the APNs key (`APPLE_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`,
  set by go-live step 8). Phones are stored per person in KV (`apns:<user id>`, up to 10).
- **Sandbox or production:** apps run from Xcode get sandbox tokens; TestFlight and App Store builds get production
  ones. The server tries the phone's last known environment, switches when Apple answers `BadDeviceToken`, and
  remembers. Tokens Apple retires (410) are dropped.
- **App** (`src/lib/nativePush.ts`, `@capacitor/push-notifications`): the Notifications toggle in your profile and the
  prompt after an RSVP ask iOS for permission, register the phone (`POST /api/push/apns`), and keep the token. Each
  launch re-registers a phone that has notifications on, so a new token reaches the server. Tapping a notification
  opens its event. Signing out removes the phone from the account (`POST /api/push/apns/remove`).
- **Xcode:** `App.entitlements` has `aps-environment` (development); archiving for distribution switches it to
  production. With automatic signing, Xcode adds Push Notifications to the App ID the first time it builds.

Check it: build to the simulator (Apple silicon) or a phone, sign in, RSVP to an event, and tap Turn on notifications.
Then, from the organizer's account on the web, change the event's start time: the "Updated" notification should land
within seconds, even with the phone locked. Tap it and the event opens.

## What works in Phase 0, and what's next

| Works now (bundled build) | Comes later |
| --- | --- |
| App opens offline to the splash, then the launch gate or map | Keyboard, status bar and safe-area polish (rest of Phase 1, tuned on the simulator) |
| Map, events, flyers and fonts load from assembly.rsvp | Sign in with Apple's native sheet (Apple sign-in works now through the system sheet) |
| Sign-in: Google, Apple, email code and passkeys (Face ID), kept in the keychain | Camera uploads, offline saved events (Phase 2) |
| Universal links; links stay in the app; iOS share sheet | |
| Push notifications through APNs (same messages as web push) | |
| Interest form on the gate; everything, in dev mode | |

## Apple Developer setup (Matt)

These need your Apple account; none can be done from the repo.

1. **Developer Program.** If Sign in with Apple is already live on the web, you're enrolled: skip this. Otherwise
   enroll at developer.apple.com/programs ($99 a year). Individual enrollment is same-week; an organization needs a
   D-U-N-S number and takes 2 to 4 weeks (open question in the plan).
2. **App ID.** Certificates, Identifiers & Profiles > Identifiers > App IDs: `rsvp.assembly.app`, with Push
   Notifications, Sign in with Apple, and Associated Domains turned on. If web sign-in used a different App ID,
   keep it for the web Services ID and make this one for the app. Group them under the same primary App ID when
   asked, so one Apple account is one Assembly account on both.
3. **APNs key.** Keys > new key with Apple Push Notifications service. Download the `.p8` once (Apple won't show it
   again) and note the Key ID. Keep it out of the repo (`*.p8` is gitignored); go-live step 8 makes it a Worker secret.
   Done Nov 27, 2026: "Assembly Push", Key ID `MUDH3P745C`, Sandbox & Production, team scoped.
4. **Team ID.** Membership details. It goes in the universal-links file in Phase 1.
5. **Xcode signing.** Xcode > Settings > Accounts: add your Apple ID. In the App target > Signing & Capabilities,
   pick your team and leave "Automatically manage signing" on.
6. **App Store Connect.** Apps > New App: iOS, name "Assembly", bundle ID `rsvp.assembly.app`, SKU `assembly-ios`.
   This reserves the name and opens TestFlight.

## Notes

- **Font license.** The app loads Timeless from assembly.rsvp the same way the site does, but many font licenses
  price app embedding separately from web use. Confirm the Timeless license covers an iOS app before external
  TestFlight; if it doesn't, remove `pointFontsAtServer()` from `src/main.tsx` and the app falls back to the CSS
  font stack.
- `ios/App/App/public` and `capacitor.config.json` are generated by `cap sync` and gitignored.
