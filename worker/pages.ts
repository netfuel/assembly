// Artist, venue and organizer pages: /api/artists/:slug, /api/venues/:slug, /api/organizers/:slug.
// Pages come from posting (a lineup creates artists; venues come from the venue list). An artist or venue can
// claim its page; a moderator approves. After that only the owner or a moderator edits. Organizer pages are the
// organizer's own profile, shown only once they've posted something public.
import { Hono, type Context } from "hono";
import type { AppContext, Env } from "./env";
import { EVENT_SELECT, toSummary, type EventRow } from "./events";
import { isModerator } from "./moderation";
import { notMigrated } from "./checkins";
import { rateLimit } from "./posting";
import { PAGE_LIMITS, sniffImage, validatePageEdit } from "./validate";
import type { ArtistLinks, PageClaim, PageEvent, PageEvents, PageKind, PageProfile, SceneId } from "../shared/types";

const PAGE_SIZE = 20;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const PUBLIC = "e.status IN ('live', 'cancelled')";

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

type Target = {
  kind: PageKind;
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  photo: string | null;
  links: ArtistLinks;
  cityId: string | null;
  ownerId: string | null;
  verified: boolean;
  updatedAt: string | null;
  venue?: PageProfile["venue"];
};

/** Find a page by slug (or id, for venues imported without a slug). Null when it doesn't exist or isn't public. */
export async function findPage(env: Env, kind: PageKind, slug: string): Promise<Target | null> {
  const db = env.DB;
  if (kind === "artist") {
    const r = await db
      .prepare("SELECT id, name, slug, links, claimed_by, bio, photo_key, city_id, updated_at FROM artists WHERE slug = ? OR id = ?")
      .bind(slug, slug)
      .first<{ id: string; name: string; slug: string; links: string; claimed_by: string | null; bio: string | null; photo_key: string | null; city_id: string | null; updated_at: string | null }>();
    if (!r) return null;
    return { kind, id: r.id, slug: r.slug, name: r.name, bio: r.bio, photo: r.photo_key ? `/api/media/${r.photo_key}` : null, links: parse(r.links, {}), cityId: r.city_id, ownerId: r.claimed_by, verified: !!r.claimed_by, updatedAt: r.updated_at };
  }
  if (kind === "venue") {
    const r = await db
      .prepare(
        "SELECT id, slug, name, type, address, neighborhood, lat, lng, city_id, claimed_by, bio, photo_key, links, access_notes, house_policy, updated_at FROM venues WHERE slug = ? OR id = ?",
      )
      .bind(slug, slug)
      .first<{ id: string; slug: string | null; name: string; type: string; address: string; neighborhood: string | null; lat: number; lng: number; city_id: string; claimed_by: string | null; bio: string | null; photo_key: string | null; links: string; access_notes: string | null; house_policy: string; updated_at: string | null }>();
    if (!r) return null;
    return {
      kind,
      id: r.id,
      slug: r.slug ?? r.id,
      name: r.name,
      bio: r.bio,
      photo: r.photo_key ? `/api/media/${r.photo_key}` : null,
      links: parse(r.links, {}),
      cityId: r.city_id,
      ownerId: r.claimed_by,
      verified: !!r.claimed_by,
      updatedAt: r.updated_at,
      venue: { type: r.type, address: r.address, neighborhood: r.neighborhood, lat: r.lat, lng: r.lng, accessNotes: r.access_notes, housePolicy: parse(r.house_policy, []) },
    };
  }
  // Organizers: by username, or by id for people without one. Only people who host something public have a page.
  const r = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.links, u.is_verified_organizer,
         (SELECT e.city_id FROM event_hosts h JOIN events e ON e.id = h.event_id WHERE h.user_id = u.id ORDER BY e.starts_at DESC LIMIT 1) AS city_id,
         (SELECT MAX(e.updated_at) FROM event_hosts h JOIN events e ON e.id = h.event_id WHERE h.user_id = u.id AND ${PUBLIC}) AS updated_at
       FROM users u WHERE lower(u.username) = lower(?1) OR u.id = ?1`,
    )
    .bind(slug)
    .first<{ id: string; username: string | null; display_name: string; avatar_url: string | null; bio: string | null; links: string; is_verified_organizer: number; city_id: string | null; updated_at: string | null }>();
  if (!r || !r.updated_at) return null;
  return { kind, id: r.id, slug: r.username ?? r.id, name: r.display_name, bio: r.bio, photo: r.avatar_url, links: parse(r.links, {}), cityId: r.city_id, ownerId: r.id, verified: r.is_verified_organizer === 1, updatedAt: r.updated_at };
}

/** The WHERE clause and join that pick a page's events. */
function eventScope(kind: PageKind): { join: string; where: string } {
  if (kind === "artist") return { join: "JOIN lineup_slots ls ON ls.event_id = e.id", where: "ls.artist_id = ?1" };
  if (kind === "venue") return { join: "", where: "e.venue_id = ?1" };
  return { join: "JOIN event_hosts eh ON eh.event_id = e.id", where: "eh.user_id = ?1" };
}

async function counts(env: Env, t: Target) {
  const { join, where } = eventScope(t.kind);
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `SELECT SUM(CASE WHEN e.ends_at > ?2 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN e.ends_at <= ?2 THEN 1 ELSE 0 END) AS past
     FROM events e ${join} WHERE ${where} AND ${PUBLIC}`,
  )
    .bind(t.id, now)
    .first<{ up: number | null; past: number | null }>();
  return { up: r?.up ?? 0, past: r?.past ?? 0 };
}

/** Scenes across their shows, most common first, at most three. */
async function scenesOf(env: Env, t: Target): Promise<SceneId[]> {
  const { join, where } = eventScope(t.kind);
  const { results } = await env.DB.prepare(`SELECT e.scenes FROM events e ${join} WHERE ${where} AND ${PUBLIC} ORDER BY e.starts_at DESC LIMIT 50`)
    .bind(t.id)
    .all<{ scenes: string }>();
  const tally = new Map<SceneId, number>();
  for (const r of results) for (const s of parse<SceneId[]>(r.scenes, [])) tally.set(s, (tally.get(s) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
}

async function cityName(env: Env, id: string | null) {
  if (!id) return null;
  return (await env.DB.prepare("SELECT name FROM cities WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? null;
}

async function profileOf(env: Env, t: Target, userId: string | null): Promise<PageProfile> {
  const [n, scenes, city, mod] = await Promise.all([counts(env, t), scenesOf(env, t), cityName(env, t.cityId), isModerator(env, userId)]);
  let viewerClaim: PageProfile["viewerClaim"] = "none";
  if (userId && t.ownerId === userId) viewerClaim = "owner";
  else if (userId && t.kind !== "organizer") {
    const open = await env.DB.prepare("SELECT 1 FROM page_claims WHERE target_type = ? AND target_id = ? AND user_id = ? AND status = 'open'")
      .bind(t.kind, t.id, userId)
      .first();
    if (open) viewerClaim = "pending";
  }
  return {
    kind: t.kind,
    id: t.id,
    slug: t.slug,
    name: t.name,
    bio: t.bio,
    photoUrl: t.photo,
    city,
    scenes,
    links: t.links,
    claimed: !!t.ownerId,
    verified: t.verified,
    viewerCanEdit: !!userId && (t.ownerId === userId || mod),
    viewerClaim,
    upcomingCount: n.up,
    pastCount: n.past,
    updatedAt: t.updatedAt,
    venue: t.venue,
  };
}

/** Upcoming (soonest first) or past (latest first), PAGE_SIZE at a time. The cursor is the last start time. */
export async function pageEvents(env: Env, t: Target, when: "upcoming" | "past", cursor: string | null, limit = PAGE_SIZE): Promise<PageEvents> {
  const { join, where } = eventScope(t.kind);
  const now = new Date().toISOString();
  const upcoming = when === "upcoming";
  const extra = t.kind === "artist" ? ", ls.set_start AS set_start, ls.room AS room" : "";
  const select = EVENT_SELECT.replace("FROM events e LEFT JOIN venues v ON v.id = e.venue_id", `${extra} FROM events e LEFT JOIN venues v ON v.id = e.venue_id ${join}`);
  const { results } = await env.DB.prepare(
    `${select}
     WHERE ${where} AND ${PUBLIC} AND ${upcoming ? "e.ends_at > ?2" : "e.ends_at <= ?2"}
       ${cursor ? (upcoming ? "AND e.starts_at > ?3" : "AND e.starts_at < ?3") : ""}
     ORDER BY e.starts_at ${upcoming ? "ASC" : "DESC"} LIMIT ${limit + 1}`,
  )
    .bind(...(cursor ? [t.id, now, cursor] : [t.id, now]))
    .all<EventRow & { set_start?: string | null; room?: string | null }>();
  const page = results.slice(0, limit);
  const events: PageEvent[] = page.map((r) => ({ ...toSummary(r), ...(t.kind === "artist" ? { setStart: r.set_start ?? null, room: r.room ?? null } : {}) }));
  return { events, next: results.length > limit ? page[page.length - 1].starts_at : null };
}

export const pages = new Hono<AppContext>();

const KINDS: Record<string, PageKind> = { artists: "artist", venues: "venue", organizers: "organizer" };

function kindOf(c: Context<AppContext>): PageKind | null {
  return KINDS[c.req.param("kind") ?? ""] ?? null;
}

const missing = (kind: PageKind) =>
  kind === "artist" ? "We couldn't find that artist." : kind === "venue" ? "We couldn't find that venue." : "We couldn't find that organizer.";

pages.get("/:kind/:slug", async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.notFound();
  try {
    const t = await findPage(c.env, kind, c.req.param("slug"));
    if (!t) return c.json({ error: missing(kind) }, 404);
    const userId = c.get("userId");
    c.header("Cache-Control", userId ? "private, no-store" : "public, max-age=60");
    return c.json(await profileOf(c.env, t, userId));
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Pages aren't set up on this server yet." }, 503);
    throw err;
  }
});

pages.get("/:kind/:slug/events", async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.notFound();
  try {
    const t = await findPage(c.env, kind, c.req.param("slug"));
    if (!t) return c.json({ error: missing(kind) }, 404);
    const when = c.req.query("when") === "past" ? "past" : "upcoming";
    const cursor = c.req.query("cursor");
    c.header("Cache-Control", "public, max-age=60");
    return c.json(await pageEvents(c.env, t, when, cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : null));
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Pages aren't set up on this server yet." }, 503);
    throw err;
  }
});

async function canEdit(c: Context<AppContext>, t: Target) {
  const userId = c.get("userId");
  return !!userId && (t.ownerId === userId || (await isModerator(c.env, userId)));
}

/** Owner or moderator edits an artist or venue page. Organizers edit theirs from their own profile. */
pages.put("/:kind/:slug", async (c) => {
  const kind = kindOf(c);
  if (kind !== "artist" && kind !== "venue") return c.json({ error: "Edit your organizer page from your profile." }, 400);
  if (!c.get("userId")) return c.json({ error: "Sign in to edit this page." }, 401);
  const t = await findPage(c.env, kind, c.req.param("slug"));
  if (!t) return c.json({ error: missing(kind) }, 404);
  if (!(await canEdit(c, t))) return c.json({ error: "Only the page's owner can edit it. Claim it first." }, 403);
  const v = validatePageEdit(await c.req.json().catch(() => ({})), kind);
  if (!v.ok) return c.json({ error: "Some details need another look.", fields: v.errors }, 400);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (v.value.bio !== undefined) sets.push("bio = ?"), args.push(v.value.bio);
  if (v.value.links !== undefined) sets.push("links = ?"), args.push(JSON.stringify(v.value.links));
  if (kind === "venue" && v.value.accessNotes !== undefined) sets.push("access_notes = ?"), args.push(v.value.accessNotes);
  if (kind === "venue" && v.value.housePolicy !== undefined) sets.push("house_policy = ?"), args.push(JSON.stringify(v.value.housePolicy));
  if (sets.length) {
    sets.push("updated_at = ?");
    args.push(new Date().toISOString());
    await c.env.DB.prepare(`UPDATE ${kind === "artist" ? "artists" : "venues"} SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...args, t.id)
      .run();
  }
  return c.json(await profileOf(c.env, (await findPage(c.env, kind, t.slug))!, c.get("userId")));
});

/** A square photo, already resized by the browser. Stored under pages/, which /api/media serves. */
pages.post("/:kind/:slug/photo", async (c) => {
  const kind = kindOf(c);
  if (kind !== "artist" && kind !== "venue") return c.json({ error: "Change your organizer photo from your profile." }, 400);
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to change the photo." }, 401);
  const t = await findPage(c.env, kind, c.req.param("slug"));
  if (!t) return c.json({ error: missing(kind) }, 404);
  if (!(await canEdit(c, t))) return c.json({ error: "Only the page's owner can change the photo." }, 403);
  if (!(await rateLimit(c.env.SESSIONS, `page-photo:${userId}`, 20, 3600))) return c.json({ error: "That's a lot of photo changes in an hour. Try again a little later." }, 429);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > PHOTO_MAX_BYTES) return c.json({ error: "Photos can be up to 5 MB." }, 413);
  const type = sniffImage(bytes);
  if (!type) return c.json({ error: "Use a JPG, PNG, or WebP image." }, 415);
  const table = kind === "artist" ? "artists" : "venues";
  const key = `pages/${kind}/${t.id}/${crypto.randomUUID()}.${type}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: CONTENT_TYPES[type], cacheControl: "public, max-age=31536000, immutable" } });
  const before = await c.env.DB.prepare(`SELECT photo_key FROM ${table} WHERE id = ?`).bind(t.id).first<{ photo_key: string | null }>();
  await c.env.DB.prepare(`UPDATE ${table} SET photo_key = ?, updated_at = ? WHERE id = ?`).bind(key, new Date().toISOString(), t.id).run();
  if (before?.photo_key?.startsWith(`pages/${kind}/${t.id}/`)) await c.env.MEDIA.delete(before.photo_key);
  return c.json(await profileOf(c.env, (await findPage(c.env, kind, t.slug))!, userId));
});

/** Ask to own an artist or venue page. A moderator checks the message (a DM from the artist's Instagram, say). */
pages.post("/:kind/:slug/claim", async (c) => {
  const kind = kindOf(c);
  if (kind !== "artist" && kind !== "venue") return c.json({ error: "Organizer pages belong to the organizer already." }, 400);
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to claim this page." }, 401);
  const t = await findPage(c.env, kind, c.req.param("slug"));
  if (!t) return c.json({ error: missing(kind) }, 404);
  if (t.ownerId === userId) return c.json({ error: "This page is already yours." }, 400);
  if (t.ownerId) return c.json({ error: "Someone already manages this page. If that's wrong, report the page and tell us why." }, 409);
  if (!(await rateLimit(c.env.SESSIONS, `claim:${userId}`, 5, 86400))) return c.json({ error: "That's a lot of claims for one day. Try again tomorrow." }, 429);
  const body = (await c.req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim().slice(0, PAGE_LIMITS.claim) : "";
  if (message.length < 10) return c.json({ error: "Tell us how we can confirm it's you.", fields: { message: "Tell us how we can confirm it's you." } }, 400);
  await c.env.DB.prepare(
    `INSERT INTO page_claims (id, target_type, target_id, user_id, message) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (target_type, target_id, user_id) WHERE status = 'open' DO UPDATE SET message = excluded.message`,
  )
    .bind(crypto.randomUUID(), kind, t.id, userId, message)
    .run();
  return c.json(await profileOf(c.env, t, userId));
});

const PAGE_REASONS = new Set(["wrong", "impersonation", "hateful", "spam", "other"]);

/** Report an artist or venue page: wrong details, someone posing as the artist, hateful content. */
pages.post("/:kind/:slug/report", async (c) => {
  const kind = kindOf(c);
  if (kind !== "artist" && kind !== "venue") return c.json({ error: "Report organizers from their page's report link." }, 400);
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to report a page." }, 401);
  const t = await findPage(c.env, kind, c.req.param("slug"));
  if (!t) return c.json({ error: missing(kind) }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string; note?: string };
  const reason = PAGE_REASONS.has(body.reason ?? "") ? body.reason! : "other";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const already = await c.env.DB.prepare("SELECT 1 FROM reports WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'open'")
    .bind(kind, t.id, userId)
    .first();
  if (!already) {
    await c.env.DB.prepare("INSERT INTO reports (id, target_type, target_id, reporter_id, reason) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), kind, t.id, userId, note ? `${reason}: ${note}` : reason)
      .run();
  }
  return c.json({ ok: true });
});

/* ---------- Moderators: claims ---------- */

export const pageModeration = new Hono<AppContext>();

pageModeration.use("/mod/claims*", async (c, next) => {
  if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
  c.header("Cache-Control", "private, no-store");
  await next();
});

pageModeration.get("/mod/claims", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT pc.id, pc.target_type, pc.target_id, pc.message, pc.created_at, u.id AS user_id, u.display_name,
         (SELECT email FROM identities i WHERE i.user_id = u.id AND i.email IS NOT NULL LIMIT 1) AS email,
         COALESCE(a.name, v.name) AS name, COALESCE(a.slug, v.slug, v.id) AS slug
       FROM page_claims pc JOIN users u ON u.id = pc.user_id
       LEFT JOIN artists a ON pc.target_type = 'artist' AND a.id = pc.target_id
       LEFT JOIN venues v ON pc.target_type = 'venue' AND v.id = pc.target_id
       WHERE pc.status = 'open' ORDER BY pc.created_at ASC LIMIT 200`,
    ).all<{ id: string; target_type: "artist" | "venue"; target_id: string; message: string; created_at: string; user_id: string; display_name: string; email: string | null; name: string | null; slug: string | null }>();
    const claims: PageClaim[] = results
      .filter((r) => r.name)
      .map((r) => ({ id: r.id, kind: r.target_type, targetId: r.target_id, slug: r.slug ?? r.target_id, name: r.name!, user: { id: r.user_id, displayName: r.display_name, email: r.email }, message: r.message, createdAt: r.created_at }));
    return c.json({ claims });
  } catch (err) {
    if (notMigrated(err)) return c.json({ claims: [] });
    throw err;
  }
});

/** approve: the claimant owns the page (other open claims on it are declined). decline: close it. */
pageModeration.post("/mod/claims/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "approve" && body.action !== "decline") return c.json({ error: "Action must be approve or decline." }, 400);
  const db = c.env.DB;
  const claim = await db.prepare("SELECT id, target_type, target_id, user_id FROM page_claims WHERE id = ? AND status = 'open'")
    .bind(c.req.param("id"))
    .first<{ id: string; target_type: "artist" | "venue"; target_id: string; user_id: string }>();
  if (!claim) return c.json({ error: "That claim was already handled." }, 404);
  const now = new Date().toISOString();
  const mod = c.get("userId");
  if (body.action === "decline") {
    await db.prepare("UPDATE page_claims SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ?").bind(now, mod, claim.id).run();
    return c.json({ ok: true });
  }
  const table = claim.target_type === "artist" ? "artists" : "venues";
  await db.batch([
    db.prepare(`UPDATE ${table} SET claimed_by = ?, updated_at = ? WHERE id = ?`).bind(claim.user_id, now, claim.target_id),
    db.prepare("UPDATE page_claims SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?").bind(now, mod, claim.id),
    db.prepare("UPDATE page_claims SET status = 'declined', decided_at = ?, decided_by = ? WHERE target_type = ? AND target_id = ? AND status = 'open'").bind(now, mod, claim.target_type, claim.target_id),
  ]);
  return c.json({ ok: true });
});

/** Page links for event detail: the venue's slug, so the event page can link to it. */
export async function venueSlug(env: Env, venueId: string | null): Promise<string | null> {
  if (!venueId) return null;
  try {
    const r = await env.DB.prepare("SELECT slug FROM venues WHERE id = ?").bind(venueId).first<{ slug: string | null }>();
    return r ? (r.slug ?? venueId) : null;
  } catch (err) {
    if (notMigrated(err)) return venueId;
    throw err;
  }
}

/** The organizer's page slug: their username, or their id. */
export async function organizerSlug(env: Env, userId: string): Promise<string> {
  try {
    const r = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(userId).first<{ username: string | null }>();
    return r?.username ?? userId;
  } catch {
    return userId;
  }
}
