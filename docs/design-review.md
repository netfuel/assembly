# Design review: minimal and progressive

Branches: `design-review`, `design-review-2`. Measured at 390×844 and 360×780, in dark and light, using the scratchpad audit script. "Controls" counts visible interactive elements in the first viewport. "Small targets" counts those under 44 px.

## Decisions

- **Sheet-first home.** The top bar is quiet: the logo, Post, and you. Everything else lives in one bottom sheet. Its header holds Search, one date pill, and Filters; any other active filters show as a single summary line.
  - Peek shows the header.
  - Half shows tonight's cards and Friends tonight.
  - Full shows the feed.
  - Drag or flick between the three. The grab handle is a tap shortcut.
  - On wide screens the sheet becomes a left panel that always shows the feed.
- **No tab bar.** The Map/Feed toggle is gone. The sheet's height *is* the toggle.
- **Feed cards** show when, the title, where, one scene, and RSVP. Share, Show on map and Details are in a ••• menu, and the pitch moves to the event page.
- **Event page: one state, one primary action**, pinned in a bottom bar.
  - Before the night: RSVP (Going ✓ once you've RSVP'd). Tickets is the secondary button when there's a link.
  - Doors open: Check in, then See the wall.
  - After: See the wall.
  - Cancelled: no primary.
  - Save, Directions and Share are icons. On phones, Directions moves into Details when the bar also carries Tickets.
  - The Story card is in the Share sheet.
- **Collapsed sections, ordered by the night's state.**
  - Upcoming: Details (lineup, door, getting there, promo), then Friends.
  - Live: Here now (check-in and friends here), Wall, Details.
  - After: Wall, Details.
  - The relevant section opens on its own. The rest are single rows with a one-line summary.
- **Posting in three steps.**
  - Essentials: name, when, where, scene.
  - Details (optional): flyer, pitch, tickets, lineup.
  - More (optional): description, door tags, promo video.
  - Post is enabled as soon as the essentials are valid, from any step. Steps 2 and 3 show a live preview of the feed card.
  - A server error jumps to the step and field it belongs to.
- **Beta modules behind flags.** Wall, Friends and Check-in are all on by default. Set `FEATURES_OFF=wall,friends,checkin` (any subset) to switch modules off:
  - The API answers 404 for their routes, so old clients can't reach them either.
  - `/api/config` reports `features`, and the app hides their sections and actions.
- **Motion.**
  - No idle loops on content screens: the live dot and the check-in dot are still.
  - Gradients appear only on state (the selected segment) or feedback (the toast).
  - At most 2 pieces of generated art animate at once.
  - All JS motion goes through one module, `src/lib/motion.ts` (GSAP, `useGSAP` for cleanup, reduced-motion aware). Components don't call `matchMedia` themselves; they use `reducedMotion()`.
  - The logo has no idle animation.

## Typography and scale

Six steps, each with one role. Nothing in the UI is set outside these sizes (the generated flyer art is the exception).

| Token | Size | Role |
| --- | --- | --- |
| `--text-2xs` | 12 | Labels (uppercase, tracked) |
| `--text-xs` | 14 | Meta, hints, errors, buttons |
| `--text-sm` | 16 | Body, inputs (no iOS zoom) |
| `--text-md` | 18 | Lead, venue names, section rows |
| `--text-lg` | 26 | Titles (feed, cards, preview) |
| `--text-xl`–`2xl` | 40–52 | Display (event and sheet titles, `clamp`ed, `text-wrap: balance`) |

Leading and tracking tokens (`--leading-display/title/body/meta`, `--tracking-title`) go with the steps. Body text has kerning, ligatures and contextual alternates on. Field hints and errors moved from 12 to 14 px.

Touch targets:
- md buttons are 44 px.
- sm buttons are 36 px visible, padded out to a 44 px hit area.
- lg buttons are 52 px.

## Chrome budget (390×844, dark)

| Screen | Controls before → after | Small targets before → after | Idle loops before → after |
| --- | --- | --- | --- |
| Map (home) | 13 → 11 | 10 → 5 | 0 → 0 |
| Feed | 14 → 15 | 12 → 6 | 0 → 0 |
| Event | 14 → 17 | 10 → 7 | 2 → 0 |
| Filters | 41 → 18 | 36 → 0 (the Close button is now 44 px too) | 0 → 0 |
| Search | 15 → 13 | 12 → 7 | 0 → 0 |
| Profile | 22 → 20 | 18 → 12 | 0 → 0 |
| Posting | 19 → 23 | 14 → 8 | 0 → 0 |

The event page and the posting flow have a few more controls than before. Each collapsed section row and each step tab is one tap target, standing in for content that used to be fully expanded, so the screens are shorter. Filters went from 39 controls to 18: the When group is gone (the date pill owns time), Door, Price and Venue are one-line rows that open on tap (or start open when set), and every chip is 44 px. With all three rows open it is 34 controls.

## Not done yet

- Profile has not been redesigned yet.
- Comments on events (the review lists them under sections) don't exist yet.
- "Watch" as a live primary action waits for live streaming.

## Animation inventory

Derived from the code (`@keyframes` and `src/lib/motion.ts`). Anything new has to fit a row here or replace one.

| Piece | Where | Layer | Trigger |
| --- | --- | --- | --- |
| Splash (lines form the A, A grows) | `lib/splash.ts` | ambient, once | cold start |
| Sheet slide, detents | `HomeSheet`, `slideTo` | on demand | drag, tap |
| Sheet-in, toast-in, install-in | `ui.css` | on demand | open |
| Child reveal, card reveal | `revealChildren`, `revealCards` | on demand | sheet or rail opens |
| Count-up (going) | `countTo` | feedback | RSVP changes |
| RSVP stamp (box-shadow ring; the one exception to transform and opacity only) | `stamp` | feedback | RSVP tap |
| Toast success ring | `toast-ring` | feedback | success |
| Badge pop | `badge-pop` | feedback | count changes |
| Search sweep | `search-sweep` | state | searching |
| Locate spinner | `locate-spin` | state | locating |
| Your-location pulse and drop | `me-pulse`, `me-drop` | state | location on |
| Skeleton shimmer | `skel-shimmer` | state | loading |
| Generated flyer art | `GeneratedArt` | ambient, max 2 at once | in view |

## Three layers

| Layer | What lives there | Rule |
| --- | --- | --- |
| Ambient | map, flyers and generated art, the live pin | Never takes a tap. No idle loops on content screens. |
| Always visible | the top bar (logo, Post, you), the sheet header (search, date pill, Filters), one primary action per screen | Chrome budget above. Nothing new gets added here without removing something. |
| On demand | filters, ••• menus, collapsed sections, share, wall, check-in | Revealed by a tap or drag, and states what is inside in a one-line summary. |

## Tap rule

Common actions take at most two taps from the home screen: find tonight's event (0), RSVP (2: card, RSVP), share (2), open directions (2), filter by scene (2: Filters, scene, then Show). Everything else may take three. Every target is at least 44 px.

## Control inventory (390×844)

Map 11, Feed 15, Event 17, Filters 18 (34 fully open), Search 13, Profile 20, Posting 23. These are the budgets: a change that raises a number has to say what it replaces.

## Feature entry rule

Before adding a feature, answer three questions in the PR:
1. Does it need a persistent control? Usually no.
2. Which layer does it live in (above), and what does the user see before they open it?
3. What does it replace or remove?
