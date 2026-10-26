# Design review: minimal and progressive

Branch: `design-review`. Measured at 390×844 and 360×780, in dark and light, using the scratchpad audit script. "Controls" counts visible interactive elements in the first viewport. "Small targets" counts those under 44 px.

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
  - Sheet motion goes through one module (`src/lib/sheetMotion.ts`, GSAP, reduced-motion aware).
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
| Filters | 41 → 39 | 36 → 31 | 0 → 0 |
| Search | 15 → 13 | 12 → 7 | 0 → 0 |
| Profile | 22 → 20 | 18 → 12 | 0 → 0 |
| Posting | 19 → 23 | 14 → 8 | 0 → 0 |

The event page and the posting flow have a few more controls than before. Each collapsed section row and each step tab is one tap target, standing in for content that used to be fully expanded, so the screens are shorter. Filters barely moved: its chips are still under 44 px tall. Redesigning that sheet is next (its When row also repeats the date pill).

## Not done yet

- Profile and the filter chips have not been redesigned yet.
- Comments on events (the review lists them under sections) don't exist yet.
- "Watch" as a live primary action waits for live streaming.
