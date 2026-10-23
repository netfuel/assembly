# Assembly PRD

Oct 23, 2026 · Matt · Living doc: https://claude.ai/artifact/1tFSZkf9n1XXcZHNf1gJgc (source of truth; this file is a snapshot)

## Overview

Assembly is a map-first PWA where the underground music scene finds tonight's parties: DIY shows, warehouse raves, queer dance nights, and small bars and clubs. Launch city is Memphis, with a template to open new cities.

**Pitch:** open the app, see the city light up with what's happening tonight and this weekend, RSVP, and plan your night.

**Problem:** underground events live in Instagram stories, group chats, and photocopied flyers. They vanish in 24 hours, are hard to find if you're not already in the circle, and details often land so late that people can't plan their night. Mainstream tools (Eventbrite, RA, DICE) are ticketing-first and club-first; Partiful is invite-first with no discovery; Sniffies proves a live map can be the whole interface.

**Our angle:** discovery on a live map, plus Partiful-grade event pages that organizers are proud to share. Every event shows its full details (address, time, lineup, door) from the moment it's posted, so people can plan ahead.

**Theme:** 90s underground rave first, with a light nod to the high school assembly in the name, a few labels, and the occasional empty state.

## Audience

The core user is 21 to 35, already goes out 2+ nights a month, and follows the scene through Instagram and word of mouth. Queer and trans nightlife is a first-class audience, not a filter. Organizers are the supply side and the growth engine: every shared event page recruits attendees.

| Persona | Who they are | Job to be done | What they need from Assembly |
| --- | --- | --- | --- |
| The regular (attendee) | Goes out weekly, knows a few crews, wants to find the next room | "What's good tonight near me, and who's going?" | Live map, tonight filter, friends going, fast RSVP |
| The newcomer (attendee) | New to the city or the scene, queer kid looking for their people | "Where can I go that's safe and welcoming?" | Door policies, vibe tags, queer-centered label, no gatekeeping on discovery |
| The promoter (organizer) | Runs a monthly party or a crew, posts flyers on IG | "Fill the room without a ticketing middleman taking my audience" | Fast posting, flyer + video, artist links, RSVP list, external ticket link, share card |
| The DIY host | Runs a house venue, basement, or warehouse | "Get the right people in and keep the night running smoothly" | Clear door policies, capacity caps, RSVP list, day-of updates |
| The artist | DJ, band, performer on lineups | "Get booked and grow my following" | Artist profile, linked sets (SoundCloud, Bandcamp, Mixcloud), lineup credits |
| The venue (bar or club) | Small bar or club with a regular calendar | "Keep my calendar visible without extra work" | Venue page, recurring events, claim and verify |

**Launch audience size (Memphis):** to be confirmed with Matt. Open question: how many active promoters and DIY spaces can we personally onboard before launch?

## Goals, non-goals, and metrics

The launch goal is to become the default place Memphis organizers post underground events within 90 days of launch.

**Goals**

- Make tonight's and this weekend's underground scene visible on one map in under 3 seconds from app open.
- Make posting an event faster than making an Instagram story (target: under 2 minutes with a flyer).
- Give people everything they need to plan ahead: address, times, lineup, door price, and policies, visible from the moment an event is posted.
- Give organizers an event page good enough to share instead of a Linktree.

**Non-goals for v1**

- Selling tickets or holding money. Tickets are external links (DICE, RA, Eventbrite, Posh, Venmo, door).
- Messaging between users. Comments and DMs bring moderation load we can't staff yet.
- Large festivals, arena shows, and mainstream club promotions.
- Native iOS and Android apps. The PWA comes first.

**Success metrics (first 90 days, Memphis)**

| Metric | Target | Why it matters |
| --- | --- | --- |
| Events posted per week | 25+ | Supply: the map has to look alive |
| Active organizers | 40+ | Organizers bring their audience |
| Weekly active users | 1,500+ | Demand |
| RSVP rate from event page views | 15%+ | Pages convert |
| Share-to-new-user rate | 1 new signup per 5 shares | Viral loop works |
| PWA installs | 20% of WAU | Retention signal |

Targets are first-pass estimates for discussion.

## Look and feel

Assembly feels like a 90s rave flyer come to life on a night map: photocopy texture, info-line typography, and UV and sodium-light color. The high school assembly is a light seasoning in the name and a handful of labels, never the main event. Organizer content (real flyers, real video) always wins over the theme.

**Design principles**

1. Map first: the map is the home screen, always one tap away.
2. Flyers are the hero: organizer art is shown big and uncropped.
3. Photocopy, not gloss: texture, misregistration, and stamp marks over gradients and glass.
4. Fast in the dark: high contrast, big tap targets, one-handed use outside a club at 1 am.
5. Plain words first: standard terms (event, RSVP, profile) everywhere a user takes action; theme lines only in headers and empty states.

**Where the theme shows up**

| Where the theme shows up | Example |
| --- | --- |
| App name and logo | Assembly |
| Post button | "Make an announcement" |
| Weekly digest notification | "This week's announcements" |
| Empty states | "Nothing on the schedule tonight. Check the weekend." |
| Organizer verified badge | A small varsity-letter mark |

Everything else uses standard terms: event, RSVP, interested, profile, saved, report.

**Visual system (direction, for design to refine)**

- Color: night map ground (blue-black), sodium-orange streetlight pins for general events, UV violet for queer-centered events, flyer pink and hazard yellow as secondary accents for status. Dark-first, with a light "daytime" mode later.
- Type: a bold, slightly distressed display face from the rave flyer world, a typewriter or mono face for times, addresses, and set times, a clean grotesk for body text.
- Texture: photocopy grain, halftone, and tape on flyers; a rubber-stamp effect when you RSVP.
- Motion: pins pulse when an event is live; the RSVP confirms with a short stamp animation; respect reduced motion.
- Iconography: smiley, megaphone, and flyer-tape motifs, used sparingly.

**Reference moods:** 90s rave flyers and info-line culture, xeroxed zines, Partiful's playful event pages, Sniffies' full-bleed live map.

## Features and requirements

P0 ships at launch, P1 within 60 days after, P2 is later. Everything below is a proposal for review.

| Area | Requirement | Priority |
| --- | --- | --- |
| Map | Full-screen live map of the city with event pins; pin size reflects RSVP count; pins pulse when live | P0 |
| Map | Pin color by scene: UV violet for queer-centered, sodium orange for everything else | P0 |
| Map | Filters: tonight, this weekend, next 7 days, pick a date; scenes (queer, rave, techno, house and disco, jungle and bass, DIY, live bands, bar and club) | P0 |
| Map | Bottom rail of event cards synced with the map; tap a card to fly to its pin | P0 |
| Map | "Near me" using device location, with permission | P1 |
| Map | Heat view of the busiest blocks tonight | P2 |
| Event page | Flyer (hero), title, one-line pitch, date, door and end times, full address, lineup with set times, door price, policy tags | P0 |
| Event page | Promo video, up to 1:30, autoplays muted on the page and in the card when in view | P0 |
| Event page | Artist links per lineup entry: Instagram, SoundCloud, Bandcamp, Mixcloud, Resident Advisor, Spotify, personal site | P0 |
| Event page | Ticket button linking out to the organizer's platform; no payments in-app | P0 |
| Event page | Directions: open in Apple Maps or Google Maps; parking and transit notes from the organizer | P0 |
| Event page | Share: copy link, native share sheet, Instagram story card (flyer + date + QR) | P0 |
| Event page | Who's going: count and friends' faces (only users who opt in) | P1 |
| Posting | "Make an announcement" flow: flyer upload, title, venue or address, date, times, scenes, door info, ticket link | P0 |
| Posting | Flyer upload: JPG, PNG, WebP, HEIC; up to 10 MB; auto-generate map thumbnail and story card | P0 |
| Posting | Promo video upload: MP4 or MOV, max 90 seconds enforced server-side, transcoded for streaming | P0 |
| Posting | Lineup builder: add artists, set times, and links; reuse artist profiles across events | P0 |
| Posting | Edit after posting, with an "updated" flag and a notice to everyone who RSVP'd | P0 |
| Posting | Recurring events (weekly, monthly) | P1 |
| Posting | Co-hosts: multiple organizers on one event | P1 |
| Posting | Capacity cap with a waitlist | P1 |
| Accounts | Sign in with Google and Apple | P0 |
| Accounts | Social sign-in: see open question on Instagram; Discord as a candidate | P1 |
| Accounts | Profile: name, photo, pronouns, scenes, links; attendance history visible only if the user opts in | P0 |
| Accounts | Organizer and artist profiles with follow | P1 |
| RSVP | One-tap RSVP and "Interested"; saved to the user's list | P0 |
| RSVP | Add to calendar (ICS) with address and times | P0 |
| Notifications | Web push: event changes or cancellations, starting soon | P0 |
| Notifications | Weekly digest ("This week's announcements") of followed organizers and scenes | P1 |
| PWA | Installable, offline shell, saved events cached so address and set times work with no signal | P0 |
| Cities | Multi-city data model from day one; Memphis only at launch | P0 |
| Venues | Venue pages, claim and verify for bars and clubs | P1 |
| Moderation | Report an event or user; organizer verification badge | P0 |

## Key flows

Four flows define launch. Each should complete one-handed in under the time listed.

**1. Find something tonight (attendee, 30 seconds)**

1. Open the app: the map loads on tonight with live pins pulsing.
2. Tap a scene chip (for example Queer) to narrow the map.
3. Swipe the card rail or tap a pin to open the event.
4. Watch the promo video, scan the lineup, tap an artist to hear them.
5. RSVP (sign in with Google or Apple if first time) and add it to the calendar.

**2. Make an announcement (organizer, 2 minutes)**

1. Tap "Make an announcement".
2. Upload the flyer; title and date are suggested from the flyer text where possible (P1).
3. Pick a listed venue or enter an address; add parking, entrance, or transit notes.
4. Add the lineup with set times and artist links.
5. Add an optional promo video (max 1:30), door price, policy tags, and ticket link.
6. Preview, post, and get the share card for Instagram stories.

**3. Plan the weekend (attendee, 1 minute)**

1. Switch the filter to this weekend: the map shows Friday through Sunday, with a day chip on each card.
2. Mark a few events Interested to compare; RSVP to the ones you'll hit.
3. Saved events show address, set times, and directions, and stay available offline at the door.
4. If the organizer changes anything, everyone who RSVP'd gets a push notification.

**4. Share and recruit (organizer and attendee, 10 seconds)**

1. Tap Share on an event: copy link, native share sheet, or story card with QR.
2. A non-user opens the link: the event page loads without sign-in.
3. RSVPing prompts sign-in, then offers "Install Assembly".

## Trust, safety, and privacy

Event information is public so people can plan; attendee information stays private by default. Queer attendees and newcomers should know a room is welcoming before they walk in.

- **Public event details:** address, times, lineup, and door info are visible to anyone, signed in or not, from the moment an event is posted. Organizers are told this clearly in the posting flow.
- **Attendee privacy:** RSVPs are private by default. Showing up on "who's going" is opt-in per user. No public attendance history unless the user turns it on.
- **No user location tracking:** "near me" uses location on device only; we never store or show a user's position. This is a deliberate break from the Sniffies model.
- **Door policy tags:** queer-centered, all ages, 18+, 21+, sliding scale, accessible entrance, sober-friendly, harm reduction on site, no photos on the dance floor. Organizers pick; attendees filter.
- **Organizer verification:** verified badge for organizers vetted by the Assembly team or vouched for by two verified organizers.
- **Reporting:** report an event or user; events with 3+ reports are hidden pending review. Launch moderation is the founding team; target response under 12 hours on weekends.
- **Content rules:** no events promoting hate, no sale of drugs or weapons, no sexual services. Harm reduction information is allowed and encouraged.
- **Data:** minimal collection, delete-my-account in settings, no selling data, no ad tracking pixels.

## Technical architecture

Assembly is a React PWA served from Cloudflare Pages, with one Workers API and Cloudflare storage behind it. One vendor keeps cost and ops low for a small team.

Diagram (in the living doc): PWA → Cloudflare Pages (app files) and Workers API (API calls); Workers API → D1, R2, Stream, KV; Workers API → Google + Apple OAuth; Cron triggers + Queues → Web Push.

The Workers API is the only thing that touches data; the client never reads D1, R2, or KV directly. Flyers upload to R2 through short-lived signed URLs, and videos upload straight to Stream with a one-time upload URL that caps length at 90 seconds.

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React + Vite, vite-plugin-pwa (Workbox) | Installable, offline shell, saved events cached for the door |
| Map | MapLibre GL with Protomaps tiles on R2 | No per-load map fees; custom night style in our palette |
| API | Cloudflare Workers with Hono | Same deploy as Pages Functions or a separate Worker |
| Database | D1 | Events, venues, users, RSVPs, artists; geo queries by bounding box |
| Media | R2 for flyers and story cards; Stream for promo video | Stream handles transcoding, thumbnails, and the 90 s limit |
| Auth | OAuth 2 with Google and Apple, sessions in KV with HTTP-only cookies | Apple requires a paid developer account and a Services ID |
| Jobs | Cron triggers and Queues | Reminders, change notices, weekly digest, and push fan-out |
| Push | Web Push with VAPID keys | iOS supports web push only for installed PWAs (iOS 16.4+) |
| Analytics | Cloudflare Web Analytics | Privacy-friendly, no cookies |

## Data model

Ten tables in D1 cover launch. Every event belongs to a city so new cities need no schema change.

| Table | Key fields | Notes |
| --- | --- | --- |
| cities | id, name, slug, timezone, center lat/lng, default zoom | Memphis at launch |
| users | id, display name, avatar, pronouns, bio, scenes, links, show attendance (bool), created at | One row per person |
| identities | user id, provider (google, apple), provider subject, email | Multiple sign-in methods per user |
| venues | id, city id, name, type (DIY, warehouse, bar, club, outdoor), address, lat/lng, claimed by | Optional for events at one-off addresses |
| events | id, city id, venue id, title, pitch, starts at, ends at, address, lat/lng, door price, ticket URL, policy tags, scenes, flyer key, video id, status (live, cancelled), updated at | Address and lat/lng stored on the event even when a venue is set |
| event hosts | event id, user id, role (owner, co-host) | Co-hosts in P1 |
| artists | id, name, slug, links (JSON: instagram, soundcloud, bandcamp, mixcloud, ra, spotify, site), claimed by | Reused across events |
| lineup slots | event id, artist id, set start, set end, room, order | Set times and rooms |
| rsvps | event id, user id, status (going, interested), visible (bool), created at | Private unless visible |
| reports | id, target type, target id, reporter id, reason, status | Moderation queue |

Media lives outside D1: flyers and story cards in R2 under `flyers/<event id>/`, promo videos in Stream referenced by `video id`, with Stream's `maxDurationSeconds` set to 90 on every upload URL.

## Roadmap

Four phases take Assembly from PRD to a public Memphis launch in about 12 weeks. Week counts are a first estimate and depend on team size.

| Phase | Weeks | Scope | Gate to next phase |
| --- | --- | --- | --- |
| Foundations | 1 to 3 | Design system, map style, schema, auth | PRD and designs approved |
| Core build | 4 to 8 | Map, event pages, posting, media, RSVP, PWA shell | P0 features complete |
| Private beta | 9 to 11 | 20 organizers, 200 attendees, Memphis | 25 events a week in beta |
| Public launch | 12 onward | Memphis open to all, then P1 features | |

We don't open to the public until the beta shows 25+ events a week; an empty map is worse than a late launch.

## Risks and open questions

The biggest risk is a quiet map at launch; most open questions are about how we seed and govern supply.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cold start: too few events on the map | Users open it once and leave | Hand-onboard 20+ organizers before launch; post their events for them from flyers |
| Public addresses deter some DIY hosts | Fewer DIY listings | Let hosts list a venue page or skip Assembly for those nights; revisit if it costs us key spaces |
| Unsafe or hateful events posted | Trust damage, harm | Verified badges, reporting, review before first post for new organizers |
| iOS PWA limits | Push only works after Add to Home Screen (iOS 16.4+); no install prompt | In-app install guide on iOS; email digest as backup |
| Stream and R2 costs grow with video | Monthly bill | 90 s cap, one video per event, archive videos 30 days after the event |
| Instagram sign-in | Instagram's consumer login API was retired in late 2024; current Instagram login is for business and creator accounts | Launch with Google and Apple; evaluate Discord or Instagram for organizers only |

**Questions for Matt**

- [ ] What's the target launch date, and is there an event we want to launch around?
- [ ] Who is building: you plus Claude, or a small team? Any budget for design and dev help?
- [ ] Which crews, DIY spaces, and venues can commit to posting before launch?
- [ ] Can anyone post at launch, or only approved organizers for the first 60 days?
- [ ] If a DIY host won't share an address publicly, do we turn the event away or allow "address at the door via the organizer"?
- [ ] Is the app 18+, or open to all-ages users for all-ages shows?
- [ ] Social sign-in: Discord, Instagram for organizers only, or skip for v1?
- [ ] Business model: free forever, organizer premium features, or a ticketing cut later?
- [ ] Which cities come after Memphis?
- [ ] Do we have a domain and handle locked for Assembly?
