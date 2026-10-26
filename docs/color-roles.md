# Colour roles

Every colour on screen has exactly one job. Tokens live in `src/styles/tokens.css` (the map copies them in `src/map/mapStyle.ts`). Pick a colour by its role, never because it looks right.

| Role | Tokens | Used for | Never for |
| --- | --- | --- | --- |
| Ground | `--color-ground`, `--color-surface`, `--color-surface-raised`, `--color-line`, `--color-line-strong`, `--color-glass` | Backgrounds, cards, hairlines, floating chrome | Meaning of any kind |
| Text | `--color-fg`, `--color-muted`, `--color-faint` | Copy, icons, selected states (chips, the selected pin ring), "you" on the map | — |
| Hero accent | `--color-accent`, `--color-accent-text`, `--color-accent-ink`, `--color-accent-wash` | Primary buttons, links, focus rings, controls that are on (locate following, the open date option), notification dots | Live, errors, selection on content, anything at rest on a card or flyer |
| Scene | `--color-uv` (queer-centered), `--color-sodium` (everything else) | Pins, the ring around a card's art | Buttons or status. Violet is only ever queer-centered. |
| Live | `--color-live`, `--color-live-text`, `--color-live-ink` | Live pins and their pulse, live card borders, the Live now badge, "here now" (check-ins, friends here) | Anything that isn't happening right now |
| Danger | `--color-danger` | Field errors, cancelled events, the cancelled banner | Primary actions |
| Warn | `--color-warn` | Offline | — |
| Motion gradient | `--grad-pink`, `--grad-purple`, `--grad-green`, `--grad-sweep` | Feedback and state changes only: the selected segment, the toast ring, upload progress, the locating spinner | Anything at rest. If it's on screen for more than a moment without a touch, it isn't a gradient. |

The header logo keeps the app icon's colours (black tile, white A, pink misregistration, violet dot) in both themes. It's the brand, like a printed sticker, and sits outside these roles.

## What changed in the audit

- **Live got its own colour.** It used to share the hero magenta with primary buttons, so a live pin and the RSVP button said the same thing. Live is now acid green at night (`#b8ff3c`, 16:1 on the map) and a darker green by day (`#3f8a00` for pins at 3.4:1, `#3b7700` for text at 4.5:1). It's also the only colour that pulses.
- **Errors and cancelled moved from magenta to danger red**, so an error never looks like the next thing to tap.
- **"Here now" is live green**: check-in dots and stamps, friends' faces at an event, and the Friends tonight "here" badge.
- **The selected pin is a still ring in the text colour**, no longer magenta. It can't be mistaken for live (green, pulsing) or for a scene.
- **"You" on the map is neutral**: a text-coloured dot with an accuracy circle and three rings when it first lands. It was violet and pink, which read as queer-centered and as a live pulse.
- **Gradients at rest are gone.** The compose preview's empty art is plain surface, and upload progress uses the shared sweep only while it's running.
- **Contrast fixes.**
  - Faint text was 2.9:1 (dark) and 3.0:1 (light). It's now 4.7:1 and 4.9:1.
  - Day-map orange pins were 2.3:1; they're now `#c25e00`, 3.4:1.
  - Offline amber on light was 3.0:1; it's now 4.5:1.

## Live, selected, streaming

Three states that must never look alike:

| State | Pin | Card | Motion |
| --- | --- | --- | --- |
| Live now | Live green, one size up, drawn above other pins | Live green border, Live now badge | The only loop: a ring that breathes every 2 s, for the 10 live events nearest the middle of the map. It holds still under reduced motion. |
| Selected | Still ring in the text colour | Lighter fill, stronger border | None |
| Streaming | Not built yet. When it is, it adds a small broadcast icon to the live style rather than a new colour. | | |

Live never relies on hue alone: it also reads by the word "Live", a bigger pin and the ring.

## Contrast (WCAG AA)

| Pair | Ratio |
| --- | --- |
| Live on the night map | 16.2 |
| Live text on light surface | 5.0 |
| Live pin on the day map | 3.4 (non-text, 3:1 needed) |
| Danger, dark / light | 7.1 / 5.4 |
| Accent text on light ground | 4.8 |
| Faint text, dark / light surface | 4.7 / 4.9 |
| Violet pin on the day map | 3.6 |
| Orange pin on the day map | 3.4 |
