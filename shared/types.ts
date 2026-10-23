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
  videoId: string | null;
  goingCount: number;
  isSample: boolean;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  gettingThere: string | null;
  lineup: LineupSlot[];
  viewerRsvp: RsvpStatus | null;
  updatedAt: string;
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

export interface AuthProviders {
  google: boolean;
  apple: boolean;
}
