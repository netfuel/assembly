// Validation for posting and editing events. Pure functions so they're unit-testable.
import { POLICY_TAGS, SCENES, type ArtistLinks, type PageEdit, type SceneId } from "../shared/types";

export const LIMITS = {
  title: 80,
  pitch: 140,
  description: 4000,
  gettingThere: 280,
  doorPrice: 60,
  url: 500,
  address: 160,
  neighborhood: 60,
  lineup: 30,
  artistName: 60,
  setStart: 20,
  room: 40,
  note: 80,
  maxHours: 72,
} as const;

export const ARTIST_LINK_KEYS = ["instagram", "soundcloud", "bandcamp", "mixcloud", "ra", "spotify", "site"] as const;

export interface LineupInput {
  artistId?: string;
  name: string;
  links: ArtistLinks;
  setStart: string | null;
  room: string | null;
  note: string | null;
}

export interface EventInput {
  title: string;
  pitch: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  venueId: string | null;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
  gettingThere: string | null;
  doorPrice: string | null;
  ticketUrl: string | null;
  scenes: SceneId[];
  policyTags: string[];
  flyerKey: string | null;
  videoId: string | null;
  lineup: LineupInput[];
}

export type FieldErrors = Record<string, string>;

const SCENE_IDS = new Set<string>(SCENES.map((s) => s.id));

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

function longText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:") return null;
    return u.toString().slice(0, LIMITS.url);
  } catch {
    return null;
  }
}

/** Accepts a URL with or without https:// in front, as organizers often paste "ra.co/events/…". */
export function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return httpsUrl(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "event";
}

/**
 * Checks and normalizes a posted event. `bounds` keeps pins inside the city.
 * Returns the clean input, or field errors written for the organizer.
 */
export function validateEvent(
  raw: unknown,
  opts: { now: Date; bounds: { center: [number, number]; radiusDeg: number }; userId: string; editing?: boolean },
): { ok: true; value: EventInput } | { ok: false; errors: FieldErrors } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const title = text(r.title, LIMITS.title);
  if (!title) errors.title = "Give the event a name.";

  const startsMs = typeof r.startsAt === "string" ? Date.parse(r.startsAt) : NaN;
  // No end time given: assume a full night (6 hours), as the posting form does.
  const endsMs = typeof r.endsAt === "string" && r.endsAt ? Date.parse(r.endsAt) : Number.isNaN(startsMs) ? NaN : startsMs + 6 * 3600e3;
  if (Number.isNaN(startsMs)) errors.startsAt = "Pick a date and start time.";
  if (Number.isNaN(endsMs)) errors.endsAt = "Pick an end time.";
  if (!errors.startsAt && !errors.endsAt) {
    if (endsMs <= startsMs) errors.endsAt = "The end time has to be after the start.";
    else if (endsMs - startsMs > LIMITS.maxHours * 3600e3) errors.endsAt = `Events can run up to ${LIMITS.maxHours} hours.`;
    // New events can't start in the past; edits can keep their original time.
    else if (!opts.editing && endsMs < opts.now.getTime()) errors.startsAt = "This date has already passed.";
  }

  const lat = Number(r.lat);
  const lng = Number(r.lng);
  const venueId = typeof r.venueId === "string" && r.venueId ? r.venueId : null;
  const address = text(r.address, LIMITS.address);
  if (!venueId) {
    if (!address) errors.address = "Add the address so people can find it.";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) errors.location = "Place the pin on the map.";
    else {
      const [cLng, cLat] = opts.bounds.center;
      if (Math.abs(lat - cLat) > opts.bounds.radiusDeg || Math.abs(lng - cLng) > opts.bounds.radiusDeg) {
        errors.location = "That pin is outside Memphis. Move it to the venue.";
      }
    }
  }

  const scenes = Array.isArray(r.scenes) ? [...new Set(r.scenes.filter((s): s is SceneId => typeof s === "string" && SCENE_IDS.has(s)))] : [];
  if (!scenes.length) errors.scenes = "Pick at least one scene so people can find it.";
  const policyTags = Array.isArray(r.policyTags) ? [...new Set(r.policyTags.filter((t): t is string => typeof t === "string" && t in POLICY_TAGS))] : [];

  let ticketUrl: string | null = null;
  if (typeof r.ticketUrl === "string" && r.ticketUrl.trim()) {
    ticketUrl = normalizeUrl(r.ticketUrl);
    if (!ticketUrl) errors.ticketUrl = "Use a full web address, like ra.co/events/123.";
  }

  let flyerKey: string | null = null;
  if (typeof r.flyerKey === "string" && r.flyerKey) {
    // Flyers are stored per uploader; you can only attach your own uploads.
    if (r.flyerKey.startsWith(`flyers/${opts.userId}/`) && !r.flyerKey.includes("..")) flyerKey = r.flyerKey;
    else errors.flyer = "That flyer didn't upload from this account. Try adding it again.";
  }

  let videoId: string | null = null;
  if (typeof r.videoId === "string" && r.videoId) {
    if (/^[a-f0-9]{32}$/.test(r.videoId)) videoId = r.videoId;
    else errors.video = "That video didn't upload correctly. Try adding it again.";
  }

  const lineup: LineupInput[] = [];
  if (Array.isArray(r.lineup)) {
    if (r.lineup.length > LIMITS.lineup) errors.lineup = `Lineups can have up to ${LIMITS.lineup} artists.`;
    r.lineup.slice(0, LIMITS.lineup).forEach((slot, i) => {
      const s = (slot ?? {}) as Record<string, unknown>;
      const name = text(s.name, LIMITS.artistName);
      if (!name) {
        errors[`lineup.${i}.name`] = "Add the artist's name or remove this row.";
        return;
      }
      const links: ArtistLinks = {};
      const rawLinks = (s.links ?? {}) as Record<string, unknown>;
      for (const key of ARTIST_LINK_KEYS) {
        const v = rawLinks[key];
        if (typeof v === "string" && v.trim()) {
          const url = normalizeUrl(v);
          if (url) links[key] = url;
          else errors[`lineup.${i}.links.${key}`] = "Use a full web address.";
        }
      }
      lineup.push({
        artistId: typeof s.artistId === "string" && s.artistId ? s.artistId : undefined,
        name,
        links,
        setStart: text(s.setStart, LIMITS.setStart),
        room: text(s.room, LIMITS.room),
        note: text(s.note, LIMITS.note),
      });
    });
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: title!,
      pitch: text(r.pitch, LIMITS.pitch),
      description: longText(r.description, LIMITS.description),
      startsAt: new Date(startsMs).toISOString(),
      endsAt: new Date(endsMs).toISOString(),
      venueId,
      address: address ?? "",
      neighborhood: text(r.neighborhood, LIMITS.neighborhood),
      lat,
      lng,
      gettingThere: text(r.gettingThere, LIMITS.gettingThere),
      doorPrice: text(r.doorPrice, LIMITS.doorPrice),
      ticketUrl,
      scenes,
      policyTags,
      flyerKey,
      videoId,
      lineup,
    },
  };
}

/** Image type from the first bytes. We never trust the client's Content-Type for uploads. */
export function sniffImage(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

export const PROFILE_LIMITS = { displayName: 40, pronouns: 24, bio: 280 } as const;

export interface ProfileInput {
  displayName: string;
  pronouns: string | null;
  bio: string | null;
  scenes: SceneId[];
  links: ArtistLinks;
  showAttendance: boolean;
}

/** Validates a profile edit. Same link rules as artist links. */
export function validateProfile(raw: unknown): { ok: true; value: ProfileInput } | { ok: false; errors: FieldErrors } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  const displayName = text(r.displayName, PROFILE_LIMITS.displayName);
  if (!displayName) errors.displayName = "Add a name people will recognize.";
  const links: ArtistLinks = {};
  const rawLinks = (r.links ?? {}) as Record<string, unknown>;
  for (const key of ARTIST_LINK_KEYS) {
    const v = rawLinks[key];
    if (typeof v === "string" && v.trim()) {
      const url = normalizeUrl(v);
      if (url) links[key] = url;
      else errors[`links.${key}`] = "Use a full web address.";
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      displayName: displayName!,
      pronouns: text(r.pronouns, PROFILE_LIMITS.pronouns),
      bio: longText(r.bio, PROFILE_LIMITS.bio),
      scenes: (Array.isArray(r.scenes) ? r.scenes : []).filter((s): s is SceneId => typeof s === "string" && SCENE_IDS.has(s)).slice(0, SCENES.length),
      links,
      showAttendance: r.showAttendance === true,
    },
  };
}

export const PAGE_LIMITS = { bio: 600, accessNotes: 400, claim: 400 } as const;

/** An owner's edit to an artist or venue page. Only the fields present change. */
export function validatePageEdit(raw: unknown, kind: "artist" | "venue"): { ok: true; value: PageEdit } | { ok: false; errors: FieldErrors } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  const value: PageEdit = {};
  if ("bio" in r) value.bio = longText(r.bio, PAGE_LIMITS.bio);
  if ("links" in r) {
    const links: ArtistLinks = {};
    const rawLinks = (r.links ?? {}) as Record<string, unknown>;
    for (const key of ARTIST_LINK_KEYS) {
      const v = rawLinks[key];
      if (typeof v === "string" && v.trim()) {
        const url = normalizeUrl(v);
        if (url) links[key] = url;
        else errors[`links.${key}`] = "Use a full web address.";
      }
    }
    value.links = links;
  }
  if (kind === "venue") {
    if ("accessNotes" in r) value.accessNotes = longText(r.accessNotes, PAGE_LIMITS.accessNotes);
    if ("housePolicy" in r) value.housePolicy = (Array.isArray(r.housePolicy) ? r.housePolicy : []).filter((t): t is string => typeof t === "string" && t in POLICY_TAGS);
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}
