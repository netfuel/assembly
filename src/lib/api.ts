import type {
  ArtistMatch,
  AuthProviders,
  City,
  EventDetail,
  EventSummary,
  GeocodeResult,
  ModItem,
  MeProfile,
  MyEvent,
  RsvpStatus,
  ServerConfig,
  Venue,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Field-level problems from the posting form, keyed by field name. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("You're offline. Showing what we saved last time.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> } & T;
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status}).`, res.status, body.fields ?? {});
  return body;
}

const enc = encodeURIComponent;

/** What the posting form sends. Matches EventInput on the server. */
export interface EventDraft {
  title: string;
  pitch: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venueId: string | null;
  address: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  gettingThere: string;
  doorPrice: string;
  ticketUrl: string;
  scenes: string[];
  policyTags: string[];
  flyerKey: string | null;
  videoId: string | null;
  lineup: {
    artistId?: string;
    name: string;
    links: Record<string, string>;
    setStart: string;
    room: string;
    note: string;
  }[];
}

export const api = {
  city: (slug: string) => request<City>(`/api/cities/${enc(slug)}`),
  events: (city: string, range?: { from: Date; to: Date }) =>
    request<{ events: EventSummary[] }>(
      `/api/events?city=${enc(city)}${range ? `&from=${enc(range.from.toISOString())}&to=${enc(range.to.toISOString())}` : ""}`,
    ).then((r) => r.events),
  event: (id: string) => request<EventDetail>(`/api/events/${enc(id)}`),
  me: () => request<{ user: MeProfile | null }>("/api/me").then((r) => r.user),
  updateProfile: (p: { displayName: string; pronouns: string; bio: string; scenes: string[]; links: Record<string, string>; showAttendance: boolean }) =>
    request<{ user: MeProfile }>("/api/me", { method: "PATCH", body: JSON.stringify(p) }).then((r) => r.user),
  uploadAvatar: (blob: Blob) =>
    request<{ user: MeProfile }>("/api/me/avatar", { method: "POST", body: blob, headers: { "Content-Type": blob.type } }).then((r) => r.user),
  removeAvatar: () => request<{ user: MeProfile }>("/api/me/avatar", { method: "DELETE" }).then((r) => r.user),
  deleteAccount: (confirm: string) =>
    request<{ ok: true; eventsDeleted: number }>("/api/me", { method: "DELETE", body: JSON.stringify({ confirm }) }),
  providers: () => request<AuthProviders>("/api/auth/providers"),
  config: () => request<ServerConfig>("/api/config"),
  emailStart: (email: string) => request<{ ok: true; devCode?: string }>("/api/auth/email/start", { method: "POST", body: JSON.stringify({ email }) }),
  emailVerify: (email: string, code: string) =>
    request<{ ok: true; newUser: boolean }>("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  rsvp: (id: string, status: RsvpStatus | null) =>
    status
      ? request<{ status: RsvpStatus }>(`/api/events/${enc(id)}/rsvp`, { method: "PUT", body: JSON.stringify({ status }) })
      : request<{ status: null }>(`/api/events/${enc(id)}/rsvp`, { method: "DELETE" }),

  createEvent: (draft: EventDraft) => request<{ id: string }>("/api/events", { method: "POST", body: JSON.stringify(draft) }),
  updateEvent: (id: string, draft: EventDraft) =>
    request<{ id: string }>(`/api/events/${enc(id)}`, { method: "PATCH", body: JSON.stringify(draft) }),
  cancelEvent: (id: string) => request<{ id: string; status: "cancelled" }>(`/api/events/${enc(id)}/cancel`, { method: "POST" }),
  report: (id: string, reason: string, note: string) =>
    request<{ ok: true }>(`/api/events/${enc(id)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  reportUser: (id: string, reason: string, note: string) =>
    request<{ ok: true }>(`/api/users/${enc(id)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  modQueue: () => request<{ items: ModItem[] }>("/api/mod/queue").then((r) => r.items),
  modEvent: (id: string, action: "restore" | "remove" | "dismiss") =>
    request<{ ok: true }>(`/api/mod/events/${enc(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  modUser: (id: string, action: "dismiss" | "hide-events") =>
    request<{ ok: true }>(`/api/mod/users/${enc(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  setVerified: (id: string, verified: boolean) =>
    request<{ ok: true; verified: boolean }>(`/api/mod/users/${enc(id)}/verified`, { method: "PUT", body: JSON.stringify({ verified }) }),
  myEvents: () => request<{ hosting: MyEvent[]; going: MyEvent[] }>("/api/me/events"),

  venues: () => request<{ venues: Venue[] }>("/api/venues").then((r) => r.venues),
  artists: (q: string, signal?: AbortSignal) =>
    request<{ artists: ArtistMatch[] }>(`/api/artists?q=${enc(q)}`, { signal }).then((r) => r.artists),
  geocode: (q: string, signal?: AbortSignal) =>
    request<{ results: GeocodeResult[]; error?: string }>(`/api/geocode?q=${enc(q)}`, { signal }),

  uploadFlyer: (blob: Blob) =>
    request<{ key: string; url: string }>("/api/uploads/flyer", { method: "POST", body: blob, headers: { "Content-Type": blob.type } }),
  videoUploadUrl: (seconds: number, bytes: number) =>
    request<{ uploadURL: string; uid: string }>("/api/uploads/video", { method: "POST", body: JSON.stringify({ seconds, bytes }) }),
  videoStatus: (uid: string) =>
    request<{ state: "ready" | "processing" | "error"; message: string | null; duration: number | null; thumbnail: string | null }>(
      `/api/uploads/video/${enc(uid)}`,
    ),
};

export function signInUrl(provider: "google" | "apple", returnTo: string) {
  return `/api/auth/${provider}?return_to=${enc(returnTo)}`;
}

export function devSignInUrl(name: string, returnTo: string) {
  return `/api/auth/dev?name=${enc(name)}&return_to=${enc(returnTo)}`;
}

function streamBase(uid: string, customerCode: string | null) {
  return customerCode ? `https://customer-${customerCode}.cloudflarestream.com/${uid}` : `https://videodelivery.net/${uid}`;
}

/** Stream player URL. Uses the account's customer subdomain when known. */
export function videoPlayerUrl(uid: string, customerCode: string | null, opts: { autoplay?: boolean } = {}) {
  const params = new URLSearchParams({ preload: "metadata", poster: videoThumbnailUrl(uid, customerCode) });
  if (opts.autoplay) {
    params.set("autoplay", "true");
    params.set("muted", "true");
    params.set("loop", "true");
  }
  return customerCode
    ? `https://customer-${customerCode}.cloudflarestream.com/${uid}/iframe?${params}`
    : `https://iframe.videodelivery.net/${uid}?${params}`;
}

export function videoThumbnailUrl(uid: string, customerCode: string | null) {
  return `${streamBase(uid, customerCode)}/thumbnails/thumbnail.jpg?time=2s&height=720`;
}
