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
  SearchResults,
  Presence,
  WallState,
  FriendsState,
  FriendPerson,
  FriendAt,
  UserRelation,
  HerePerson,
  PresenceVisibility,
  ServerConfig,
  Venue,
  PageClaim,
  Inbox,
  PageEdit,
  PageEvents,
  PageKind,
  PageProfile,
  ReactionKind,
  CommentThread,
  EventComment,
  Reactions,
} from "../../shared/types";

const PAGE_PATH: Record<PageKind, string> = { artist: "artists", venue: "venues", organizer: "organizers" };
const pagePath = (kind: PageKind, slug: string) => `/api/pages/${PAGE_PATH[kind]}/${encodeURIComponent(slug)}`;

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
  /** On unless the organizer turns it off. */
  flyerDownloads?: boolean;
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
  /** `fresh` skips the browser's 30-second cache, for right after you post or edit. */
  events: (city: string, range?: { from: Date; to: Date }, fresh = false) =>
    request<{ events: EventSummary[] }>(
      `/api/events?city=${enc(city)}${range ? `&from=${enc(range.from.toISOString())}&to=${enc(range.to.toISOString())}` : ""}`,
      fresh ? { cache: "no-cache" } : undefined,
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

  createEvent: (draft: EventDraft) => request<{ id: string; status: "live" | "draft" }>("/api/events", { method: "POST", body: JSON.stringify(draft) }),
  updateEvent: (id: string, draft: EventDraft) =>
    request<{ id: string }>(`/api/events/${enc(id)}`, { method: "PATCH", body: JSON.stringify(draft) }),
  cancelEvent: (id: string) => request<{ id: string; status: "cancelled" }>(`/api/events/${enc(id)}/cancel`, { method: "POST" }),
  report: (id: string, reason: string, note: string) =>
    request<{ ok: true }>(`/api/events/${enc(id)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  reportUser: (id: string, reason: string, note: string) =>
    request<{ ok: true }>(`/api/users/${enc(id)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  inbox: () => request<Inbox>("/api/me/inbox"),
  react: (id: string, kind: ReactionKind, on: boolean) => request<Reactions>(`/api/events/${enc(id)}/react`, { method: "POST", body: JSON.stringify({ kind, on }) }),
  comments: (id: string) => request<CommentThread>(`/api/events/${enc(id)}/comments`),
  comment: (id: string, body: string, parentId: string | null) =>
    request<{ comment: EventComment; thread: CommentThread }>(`/api/events/${enc(id)}/comments`, { method: "POST", body: JSON.stringify({ body, parentId }) }),
  removeComment: (id: string) => request<CommentThread>(`/api/comments/${enc(id)}`, { method: "DELETE" }),
  pinComment: (id: string, pinned: boolean) => request<CommentThread>(`/api/comments/${enc(id)}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }),
  reportComment: (id: string, reason: string, note: string) =>
    request<{ ok: true; hidden: boolean }>(`/api/comments/${enc(id)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  inboxSeen: () => request<{ ok: true }>("/api/me/inbox/seen", { method: "POST" }),
  setLive: (id: string, action: "end" | "extend") =>
    request<{ endsAt: string; endedEarly: boolean }>(`/api/events/${encodeURIComponent(id)}/live`, { method: "POST", body: JSON.stringify({ action }) }),
  page: (kind: PageKind, slug: string) => request<PageProfile>(pagePath(kind, slug)),
  pageEvents: (kind: PageKind, slug: string, when: "upcoming" | "past", cursor?: string | null) =>
    request<PageEvents>(`${pagePath(kind, slug)}/events?when=${when}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  editPage: (kind: "artist" | "venue", slug: string, edit: PageEdit) => request<PageProfile>(pagePath(kind, slug), { method: "PUT", body: JSON.stringify(edit) }),
  pagePhoto: (kind: "artist" | "venue", slug: string, blob: Blob) =>
    request<PageProfile>(`${pagePath(kind, slug)}/photo`, { method: "POST", body: blob, headers: { "Content-Type": blob.type } }),
  claimPage: (kind: "artist" | "venue", slug: string, message: string) =>
    request<PageProfile>(`${pagePath(kind, slug)}/claim`, { method: "POST", body: JSON.stringify({ message }) }),
  reportPage: (kind: "artist" | "venue", slug: string, reason: string, note: string) =>
    request<{ ok: true }>(`${pagePath(kind, slug)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  modPage: (kind: "artist" | "venue", id: string, action: "dismiss" | "clear") =>
    request<{ ok: true }>(`/api/mod/pages/${kind}/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  modClaims: () => request<{ claims: PageClaim[] }>("/api/mod/claims").then((r) => r.claims),
  decideClaim: (id: string, action: "approve" | "decline") => request<{ ok: true }>(`/api/mod/claims/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  modStats: () => request<{ stats: Record<string, number> }>("/api/mod/stats").then((r) => r.stats),
  modQueue: () => request<{ items: ModItem[] }>("/api/mod/queue").then((r) => r.items),
  modEvent: (id: string, action: "restore" | "remove" | "dismiss" | "approve" | "reject") =>
    request<{ ok: true }>(`/api/mod/events/${enc(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  modUser: (id: string, action: "dismiss" | "hide-events") =>
    request<{ ok: true }>(`/api/mod/users/${enc(id)}`, { method: "POST", body: JSON.stringify({ action }) }),
  handOver: (id: string, email: string) =>
    request<{ ok: true; host: { id: string; displayName: string } }>(`/api/mod/events/${enc(id)}/host`, { method: "POST", body: JSON.stringify({ email }) }),
  setVerified: (id: string, verified: boolean) =>
    request<{ ok: true; verified: boolean }>(`/api/mod/users/${enc(id)}/verified`, { method: "PUT", body: JSON.stringify({ verified }) }),
  presence: (id: string) => request<Presence>(`/api/events/${enc(id)}/presence`),
  checkIn: (id: string, body: { method: "gps"; near: true } | { method: "code"; code: string } | { method: "host" }) =>
    request<Presence>(`/api/events/${enc(id)}/checkin`, { method: "POST", body: JSON.stringify(body) }),
  checkOut: (id: string) => request<Presence>(`/api/events/${enc(id)}/checkin`, { method: "DELETE" }),
  doorCode: (id: string, rotate = false) => request<{ code: string }>(`/api/events/${enc(id)}/door-code`, { method: rotate ? "POST" : "GET" }),
  wall: (id: string) => request<WallState>(`/api/events/${enc(id)}/wall`),
  setWallEnabled: (id: string, enabled: boolean) => request<WallState>(`/api/events/${enc(id)}/wall`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  setHighlight: (postId: string, highlight: boolean) => request<{ ok: true }>(`/api/wall/${enc(postId)}`, { method: "PATCH", body: JSON.stringify({ highlight }) }),
  removeWallPost: (postId: string) => request<{ ok: true }>(`/api/wall/${enc(postId)}`, { method: "DELETE" }),
  reportWallPost: (postId: string, reason: string, note = "") =>
    request<{ ok: true; hidden: boolean }>(`/api/wall/${enc(postId)}/report`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  modWall: () => request<{ items: ModWallItem[] }>("/api/mod/wall").then((r) => r.items),
  modWallAction: (postId: string, action: "restore" | "remove") => request<{ ok: true }>(`/api/mod/wall/${enc(postId)}`, { method: "POST", body: JSON.stringify({ action }) }),
  friends: () => request<FriendsState>("/api/friends"),
  friendSettings: (friendsOn: boolean, presenceDefault: "friends" | "me") =>
    request<FriendsState>("/api/friends/settings", { method: "PUT", body: JSON.stringify({ friendsOn, presenceDefault }) }),
  setUsername: (username: string | null) => request<FriendsState>("/api/friends/username", { method: "PUT", body: JSON.stringify({ username }) }),
  inviteToken: (rotate = false) => request<{ token: string }>("/api/friends/invite", { method: rotate ? "POST" : "GET" }),
  invitePreview: (token: string) => request<{ person: FriendPerson; relation: UserRelation }>(`/api/friends/invite/${enc(token)}`),
  acceptInvite: (token: string) => request<FriendsState>(`/api/friends/invite/${enc(token)}`, { method: "POST" }),
  lookupUsername: (u: string) => request<{ person: FriendPerson; relation: UserRelation }>(`/api/friends/lookup/${enc(u.replace(/^@/, ""))}`),
  requestFriend: (id: string) => request<FriendsState>(`/api/friends/request/${enc(id)}`, { method: "POST" }),
  acceptFriend: (id: string) => request<FriendsState>(`/api/friends/${enc(id)}/accept`, { method: "POST" }),
  removeFriend: (id: string) => request<FriendsState>(`/api/friends/${enc(id)}`, { method: "DELETE" }),
  hideFromFriend: (id: string, hidden: boolean) => request<FriendsState>(`/api/friends/${enc(id)}/hidden`, { method: "PUT", body: JSON.stringify({ hidden }) }),
  blockUser: (id: string) => request<FriendsState>(`/api/friends/${enc(id)}/block`, { method: "POST" }),
  unblockUser: (id: string) => request<FriendsState>(`/api/friends/${enc(id)}/block`, { method: "DELETE" }),
  friendsAt: () => request<{ events: Record<string, FriendAt[]> }>("/api/friends/at").then((r) => r.events),
  friendVisibility: (eventId: string) => request<{ visibility: PresenceVisibility; friendsOn: boolean }>(`/api/events/${enc(eventId)}/friend-visibility`),
  setFriendVisibility: (eventId: string, visibility: PresenceVisibility) =>
    request<{ visibility: PresenceVisibility; friendsOn: boolean }>(`/api/events/${enc(eventId)}/friend-visibility`, { method: "PUT", body: JSON.stringify({ visibility }) }),
  setFriendAlert: (id: string, on: boolean) => request<FriendsState>(`/api/friends/${enc(id)}/alert`, { method: "PUT", body: JSON.stringify({ on }) }),
  invitesSeen: () => request<FriendsState>("/api/friends/invites/seen", { method: "POST" }),
  setFindable: (on: boolean) => request<FriendsState>("/api/friends/findable", { method: "PUT", body: JSON.stringify({ on }) }),
  matchContacts: (prefixes: string[]) =>
    request<{ matches: { hash: string; person: FriendPerson; relation: UserRelation }[] }>("/api/friends/contacts", { method: "POST", body: JSON.stringify({ prefixes }) }).then((r) => r.matches),
  inviteToEvent: (eventId: string, to: string[]) => request<{ sent: number }>(`/api/events/${enc(eventId)}/invite`, { method: "POST", body: JSON.stringify({ to }) }),
  hereList: (eventId: string) => request<{ people: HerePerson[]; inRoom: boolean }>(`/api/events/${enc(eventId)}/here`),
  search: (q: string, signal?: AbortSignal) => request<SearchResults>(`/api/search?q=${enc(q)}&city=memphis`, { signal }),
  myEvents: () => request<{ hosting: MyEvent[]; going: MyEvent[] }>("/api/me/events"),

  venues: () => request<{ venues: Venue[] }>("/api/venues").then((r) => r.venues),
  artists: (q: string, signal?: AbortSignal) =>
    request<{ artists: ArtistMatch[] }>(`/api/artists?q=${enc(q)}`, { signal }).then((r) => r.artists),
  geocode: (q: string, signal?: AbortSignal) =>
    request<{ results: GeocodeResult[]; error?: string }>(`/api/geocode?q=${enc(q)}`, { signal }),

  uploadFlyerThumb: (key: string, blob: Blob) =>
    request<{ ok: true }>(`/api/uploads/flyer-thumb?key=${enc(key)}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type } }),
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

export interface ModWallItem {
  id: string;
  eventId: string;
  eventTitle: string;
  status: string;
  caption: string | null;
  author: string;
  anonymous: boolean;
  createdAt: string;
  thumbUrl: string;
  reasons: string[];
}

/** Posts a photo to an event's wall with upload progress (fetch can't report it). Resolves with the new wall. */
export function postWallPhoto(
  eventId: string,
  photo: { blob: Blob; thumb: Blob | null; width: number; height: number },
  caption: string,
  anonymous: boolean,
  onProgress: (p: number) => void,
): Promise<WallState> {
  const form = new FormData();
  const ext = (b: Blob) => (b.type === "image/webp" ? "webp" : b.type === "image/png" ? "png" : "jpg");
  form.append("photo", photo.blob, `photo.${ext(photo.blob)}`);
  if (photo.thumb) form.append("thumb", photo.thumb, `thumb.${ext(photo.thumb)}`);
  form.append("caption", caption);
  form.append("anonymous", anonymous ? "1" : "0");
  form.append("width", String(photo.width));
  form.append("height", String(photo.height));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/events/${enc(eventId)}/wall`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // fall through
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as WallState);
      else reject(new ApiError((body as { error?: string } | null)?.error ?? "Couldn't post that photo. Try again.", xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("You look offline. Try again when you have signal.", 0));
    xhr.send(form);
  });
}
