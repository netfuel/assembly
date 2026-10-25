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
