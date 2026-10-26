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

export interface ServerConfig {
  video: boolean;
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
  | { type: "user"; id: string; title: string; verified: boolean; hosted: number; reasons: string[]; latest: string };

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
  };
  friends: (FriendPerson & { hidden: boolean })[];
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
