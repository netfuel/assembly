// Types shared by the React app and the Worker API.

export const SCENES = [
  { id: "queer", label: "Queer" },
  { id: "rave", label: "Rave" },
  { id: "techno", label: "Techno" },
  { id: "house", label: "House & disco" },
  { id: "bass", label: "Jungle & bass" },
  { id: "diy", label: "DIY" },
  { id: "live", label: "Live bands" },
  { id: "bar", label: "Bar & club" },
] as const;
export type SceneId = (typeof SCENES)[number]["id"];

export const POLICY_TAGS: Record<string, string> = {
  "queer-centered": "Queer-centered",
  "all-ages": "All ages",
  "18+": "18+",
  "21+": "21+",
  "sliding-scale": "Sliding scale",
  "accessible-entrance": "Accessible entrance",
  "sober-friendly": "Sober-friendly",
  "harm-reduction": "Harm reduction on site",
  "no-photos": "No photos on the floor",
  byob: "BYOB",
};

export const VENUE_TYPES: Record<string, string> = {
  diy: "DIY space",
  warehouse: "Warehouse",
  bar: "Bar",
  club: "Club",
  outdoor: "Outdoor",
};

export type ArtistLinks = Partial<
  Record<"instagram" | "soundcloud" | "bandcamp" | "mixcloud" | "ra" | "spotify" | "site", string>
>;

export interface LineupSlot {
  artistId: string;
  name: string;
  slug: string;
  links: ArtistLinks;
  setStart: string | null;
  room: string | null;
  note: string | null;
}

export interface EventSummary {
  id: string;
  title: string;
  pitch: string | null;
  startsAt: string;
  endsAt: string;
  /** The organizer ended it early: it's over at endsAt, with no grace period. */
  endedEarly?: boolean;
  venueName: string | null;
  venueType: string | null;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
  doorPrice: string | null;
  ticketUrl: string | null;
  scenes: SceneId[];
  policyTags: string[];
  flyerUrl: string | null;
  thumbUrl: string | null;
  videoId: string | null;
  goingCount: number;
  isSample: boolean;
  /** Edited meaningfully after posting (more than 10 minutes later). */
  updated: boolean;
  status: "live" | "cancelled" | "hidden" | "draft";
  /** People checked in right now (counted only while the event is on). */
  hereNow?: number;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  gettingThere: string | null;
  lineup: LineupSlot[];
  viewerRsvp: RsvpStatus | null;
  viewerIsHost: boolean;
  /** Host, or a moderator (who can edit any event and hand it to an organizer). */
  viewerCanEdit: boolean;
  /** The organizer who posted it. */
  host: HostSummary | null;
  venueId: string | null;
  /** For the link to /v/<slug>. */
  venueSlug?: string | null;
  /** The organizer lets people download the flyer (on unless they turned it off). */
  flyerDownloads?: boolean;
  flyerKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Venue {
  id: string;
  name: string;
  type: string;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
}

export interface ArtistMatch {
  id: string;
  name: string;
  slug: string;
  links: ArtistLinks;
}

export interface GeocodeResult {
  label: string;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
}

/** Beta modules, each behind a flag (all on unless FEATURES_OFF lists them). */
export interface Features {
  wall: boolean;
  friends: boolean;
  checkin: boolean;
}

export interface ServerConfig {
  video: boolean;
  features?: Features;
  streamCustomerCode: string | null;
  /** Web push is configured (VAPID keys set). */
  push?: boolean;
  vapidPublicKey?: string | null;
}

export interface MyEvent {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  rsvp?: RsvpStatus;
}

export type RsvpStatus = "going" | "interested";

export interface City {
  id: string;
  name: string;
  timezone: string;
  center: [number, number];
  zoom: number;
}

export interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  pronouns: string | null;
}

/** The signed-in person's own profile, as returned by /api/me. */
export interface MeProfile extends Me {
  bio: string | null;
  scenes: SceneId[];
  links: ArtistLinks;
  /** Opt-in: appear on "who's going" lists. Off by default. */
  showAttendance: boolean;
  verified: boolean;
  /** Can review reports and verify organizers (listed in MODERATORS). */
  moderator: boolean;
}

export interface HostSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  /** For the link to /o/<slug>. */
  slug?: string;
}

/** One entry in the moderators' review queue. */
export type ModItem =
  | {
      type: "event";
      id: string;
      title: string;
      status: string;
      startsAt: string;
      host: { id: string; displayName: string; verified: boolean } | null;
      reasons: string[];
      latest: string;
    }
  | { type: "user"; id: string; title: string; verified: boolean; hosted: number; reasons: string[]; latest: string }
  | { type: "page"; kind: "artist" | "venue"; id: string; slug: string; title: string; claimed: boolean; reasons: string[]; latest: string };

export interface AuthProviders {
  google: boolean;
  apple: boolean;
  /** Local testing sign-in (DEV_LOGIN=1 on localhost only). */
  dev?: boolean;
  /** Sign in with a code sent by email. */
  email?: boolean;
}

/** An artist or venue in search results, with what they have coming up. */
export interface SearchPlace {
  id: string;
  name: string;
  /** For the link to /a/<slug> or /v/<slug>. */
  slug: string;
  /** Venues: address and type. Artists: null. */
  address: string | null;
  neighborhood: string | null;
  type: string | null;
  upcoming: number;
  next: { id: string; title: string; startsAt: string } | null;
}

export interface SearchResults {
  q: string;
  /** Upcoming and live events that match, best first. */
  events: EventSummary[];
  artists: SearchPlace[];
  venues: SearchPlace[];
  /** People who post nights here, by name or username. */
  organizers: SearchPlace[];
  /** Ids of every upcoming event that matches, including ones by a matching artist or at a matching venue. */
  eventIds: string[];
}

/** Check-in state for one event, for the person looking. */
export interface Presence {
  hereNow: number;
  /** Check-in is open: from 30 minutes before the start until 30 minutes after the end. */
  open: boolean;
  opensAt: string;
  closesAt: string;
  viewerIsHost: boolean;
  viewer: { checkedIn: boolean; method: "gps" | "code" | "host"; checkedOut: boolean } | null;
}

export interface WallPost {
  id: string;
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  /** Null when posted anonymously (unless you're the host or a moderator looking at your own event). */
  author: { id: string; displayName: string; avatarUrl: string | null } | null;
  anonymous: boolean;
  mine: boolean;
  highlight: boolean;
  /** Hosts and moderators also see hidden posts, marked. */
  status: "live" | "hidden";
  createdAt: string;
}

export interface WallState {
  enabled: boolean;
  /** The event is tagged "No photos on the floor": no wall. */
  photoFree: boolean;
  /** "all" for people who RSVP'd, checked in, or host; "highlights" for everyone else. */
  view: "all" | "highlights";
  canPost: boolean;
  /** Why you can't post right now, in plain words. Null when you can. */
  postNote: string | null;
  closesAt: string;
  viewerIsHost: boolean;
  posts: WallPost[];
  /** Posts you can't see until you RSVP. */
  hiddenCount: number;
}

export interface FriendPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  username: string | null;
}

export interface FriendsState {
  me: {
    username: string | null;
    /** Turned friends on (saw the explainer). Off: nobody sees your presence, and you don't see theirs. */
    friendsOn: boolean;
    /** What friends see for a new Going or check-in. */
    presenceDefault: "friends" | "me";
    /** Listed for contact matching (by email hash prefix). */
    findable: boolean;
  };
  /** alert: you asked to be told when they check in. */
  friends: (FriendPerson & { hidden: boolean; alert: boolean })[];
  /** Friends inviting you to upcoming events, newest first. */
  invites: EventInvite[];
  incoming: FriendPerson[];
  outgoing: FriendPerson[];
  blocked: FriendPerson[];
}

/** A friend at an event: going (RSVP'd) or here (checked in now). */
export interface FriendAt {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  state: "going" | "here";
}

export type UserRelation = "self" | "none" | "friends" | "incoming" | "outgoing";

export interface EventInvite {
  eventId: string;
  title: string;
  startsAt: string;
  venueName: string | null;
  from: FriendPerson;
  seen: boolean;
}

/** Who can see your presence for one night. "event": friends, plus anyone checked in to the same event. */
export type PresenceVisibility = "me" | "friends" | "event";

/** Someone checked in to the event you're at, shown because they chose "everyone here" (or they're your friend). */
export interface HerePerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  friend: boolean;
}

/* ---------- Artist, venue and organizer pages (/a/<slug>, /v/<slug>, /o/<slug>) ---------- */
export type PageKind = "artist" | "venue" | "organizer";

export interface PageProfile {
  kind: PageKind;
  id: string;
  /** What goes in the URL. Venues without one fall back to their id. */
  slug: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  city: string | null;
  /** The scenes of their shows, most common first. */
  scenes: SceneId[];
  links: ArtistLinks;
  /** Someone owns the page (an approved claim, or the organizer themself). */
  claimed: boolean;
  verified: boolean;
  /** The owner or a moderator. */
  viewerCanEdit: boolean;
  /** Has the viewer asked to claim it, or do they own it? */
  viewerClaim: "none" | "pending" | "owner";
  upcomingCount: number;
  pastCount: number;
  updatedAt: string | null;
  venue?: {
    type: string;
    address: string;
    neighborhood: string | null;
    lat: number;
    lng: number;
    accessNotes: string | null;
    housePolicy: string[];
  };
}

/** An event on a page: the summary plus, on artist pages, their set time. */
export interface PageEvent extends EventSummary {
  setStart?: string | null;
  room?: string | null;
}

export interface PageEvents {
  events: PageEvent[];
  /** Pass back as ?cursor= for the next page; null at the end. */
  next: string | null;
}

export interface PageEdit {
  bio?: string | null;
  links?: ArtistLinks;
  accessNotes?: string | null;
  housePolicy?: string[];
}

export interface PageClaim {
  id: string;
  kind: "artist" | "venue";
  targetId: string;
  slug: string;
  name: string;
  user: { id: string; displayName: string; email: string | null };
  message: string;
  createdAt: string;
}
