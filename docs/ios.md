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

## What works in Phase 0, and what's next

| Works now (bundled build) | Comes later |
| --- | --- |
| App opens offline to the splash, then the launch gate or map | Sign-in from the bundled build (Phase 1: the session cookie can't cross from `capacitor://` to `https://`, so the app gets a bearer token kept in the keychain) |
| Map, events, flyers and fonts load from assembly.rsvp | Google sign-in (Phase 1: Google blocks sign-in inside app web views, so it moves to the system browser) |
| Interest form on the gate | Sign in with Apple native sheet, universal links, native share (Phase 1) |
| Everything, in dev mode | Push via APNs, camera uploads, offline saved events (Phase 2) |

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
   again) and note the Key ID. Keep it out of the repo (`*.p8` is gitignored); it becomes a Worker secret in Phase 2.
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
