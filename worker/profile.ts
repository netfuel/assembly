import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import type { MeProfile } from "../shared/types";
import { endAllSessions, endSession } from "./session";
import { rateLimit } from "./posting";
import { sniffImage, validateProfile } from "./validate";
import { streamConfigured } from "./uploads";
import { isModerator } from "./moderation";
import { forgetPush } from "./push";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

interface UserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  pronouns: string | null;
  bio: string | null;
  scenes: string;
  links: string;
  show_attendance: number;
  is_verified_organizer: number;
}

function parse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function toProfile(row: UserRow, moderator = false): MeProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    pronouns: row.pronouns,
    bio: row.bio,
    scenes: parse(row.scenes, []),
    links: parse(row.links, {}),
    showAttendance: row.show_attendance === 1,
    verified: row.is_verified_organizer === 1,
    moderator,
  };
}

async function loadUser(env: Env, id: string) {
  return env.DB.prepare(
    "SELECT id, display_name, avatar_url, pronouns, bio, scenes, links, show_attendance, is_verified_organizer FROM users WHERE id = ?",
  )
    .bind(id)
    .first<UserRow>();
}

/** Our own avatar uploads live under avatars/<user id>/; anything else (a Google photo URL) isn't ours to delete. */
function ownAvatarKey(url: string | null, userId: string): string | null {
  const prefix = `/api/media/avatars/${userId}/`;
  return url && url.startsWith(prefix) ? url.slice("/api/media/".length) : null;
}

export const profile = new Hono<AppContext>();

profile.get("/", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const userId = c.get("userId");
  if (!userId) return c.json({ user: null });
  const row = await loadUser(c.env, userId);
  return c.json({ user: row ? toProfile(row, await isModerator(c.env, userId)) : null });
});

profile.patch("/", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to edit your profile." }, 401);
  const result = validateProfile(await c.req.json().catch(() => null));
  if (!result.ok) return c.json({ error: "Some details need another look.", fields: result.errors }, 400);
  const v = result.value;
  await c.env.DB.prepare(
    "UPDATE users SET display_name = ?, pronouns = ?, bio = ?, scenes = ?, links = ?, show_attendance = ? WHERE id = ?",
  )
    .bind(v.displayName, v.pronouns, v.bio, JSON.stringify(v.scenes), JSON.stringify(v.links), v.showAttendance ? 1 : 0, userId)
    .run();
  // RSVPs follow the profile setting, so turning it off hides you from every "who's going" list at once.
  await c.env.DB.prepare("UPDATE rsvps SET visible = ? WHERE user_id = ?").bind(v.showAttendance ? 1 : 0, userId).run();
  const row = await loadUser(c.env, userId);
  return c.json({ user: row ? toProfile(row, await isModerator(c.env, userId)) : null });
});

/** Profile photo: the browser sends a square image it has already resized. */
profile.post("/avatar", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to change your photo." }, 401);
  if (!(await rateLimit(c.env.SESSIONS, `avatar:${userId}`, 20, 3600))) {
    return c.json({ error: "That's a lot of photo changes in an hour. Try again a little later." }, 429);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > AVATAR_MAX_BYTES) return c.json({ error: "Photos can be up to 5 MB." }, 413);
  const type = sniffImage(bytes);
  if (!type) return c.json({ error: "Use a JPG, PNG, or WebP image." }, 415);

  const key = `avatars/${userId}/${crypto.randomUUID()}.${type}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: CONTENT_TYPES[type], cacheControl: "public, max-age=31536000, immutable" } });
  const before = await c.env.DB.prepare("SELECT avatar_url FROM users WHERE id = ?").bind(userId).first<{ avatar_url: string | null }>();
  await c.env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(`/api/media/${key}`, userId).run();
  const old = ownAvatarKey(before?.avatar_url ?? null, userId);
  if (old) await c.env.MEDIA.delete(old);
  const row = await loadUser(c.env, userId);
  return c.json({ user: row ? toProfile(row, await isModerator(c.env, userId)) : null });
});

profile.delete("/avatar", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to change your photo." }, 401);
  const before = await c.env.DB.prepare("SELECT avatar_url FROM users WHERE id = ?").bind(userId).first<{ avatar_url: string | null }>();
  await c.env.DB.prepare("UPDATE users SET avatar_url = NULL WHERE id = ?").bind(userId).run();
  const old = ownAvatarKey(before?.avatar_url ?? null, userId);
  if (old) await c.env.MEDIA.delete(old);
  const row = await loadUser(c.env, userId);
  return c.json({ user: row ? toProfile(row, await isModerator(c.env, userId)) : null });
});

/**
 * Deletes the account: profile, sign-in links, RSVPs, reports filed, uploaded photos and flyers,
 * and events this person hosted alone. Events with other hosts stay with those hosts.
 */
profile.delete("/", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm?.trim().toLowerCase() !== "delete") return c.json({ error: 'Type "delete" to confirm.' }, 400);

  const db = c.env.DB;
  const { results: solo } = await db
    .prepare(
      `SELECT e.id, e.video_id FROM events e JOIN event_hosts h ON h.event_id = e.id
       WHERE h.user_id = ? AND NOT EXISTS (SELECT 1 FROM event_hosts o WHERE o.event_id = e.id AND o.user_id != ?)`,
    )
    .bind(userId, userId)
    .all<{ id: string; video_id: string | null }>();

  // Wall photos on events that go away with this account (anyone's), cleaned up below.
  let soloWallKeys: string[] = [];
  if (solo.length) {
    try {
      const { results } = await db
        .prepare(`SELECT media_key, thumb_key FROM wall_posts WHERE event_id IN (${solo.map(() => "?").join(",")})`)
        .bind(...solo.map((e) => e.id))
        .all<{ media_key: string; thumb_key: string | null }>();
      soloWallKeys = results.flatMap((r) => [r.media_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
    } catch {
      // No wall table yet.
    }
  }

  await db.batch([
    ...solo.map((e) => db.prepare("DELETE FROM events WHERE id = ?").bind(e.id)),
    db.prepare("DELETE FROM reports WHERE reporter_id = ? OR (target_type = 'user' AND target_id = ?)").bind(userId, userId),
    db.prepare("UPDATE artists SET claimed_by = NULL WHERE claimed_by = ?").bind(userId),
    db.prepare("UPDATE venues SET claimed_by = NULL WHERE claimed_by = ?").bind(userId),
    // identities, rsvps, and event_hosts cascade.
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  // Media cleanup is best-effort; the account is already gone.
  const cleanup = async () => {
    for (let i = 0; i < soloWallKeys.length; i += 500) await c.env.MEDIA.delete(soloWallKeys.slice(i, i + 500));
    for (const prefix of [`avatars/${userId}/`, `flyers/${userId}/`, `wall/${userId}/`]) {
      let cursor: string | undefined;
      do {
        const page = await c.env.MEDIA.list({ prefix, cursor });
        const keys: string[] = [];
        for (const o of page.objects) {
          // A flyer still used by an event that stays (one with other hosts) is kept.
          const flyerKey = o.key.replace(/\.thumb$/, "");
          const inUse = prefix.startsWith("flyers/") && (await db.prepare("SELECT 1 FROM events WHERE flyer_key = ?").bind(flyerKey).first());
          if (!inUse) keys.push(o.key);
        }
        if (keys.length) await c.env.MEDIA.delete(keys);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    if (streamConfigured(c.env)) {
      for (const e of solo) {
        if (!e.video_id) continue;
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${e.video_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${c.env.STREAM_API_TOKEN}` },
        }).catch(() => undefined);
      }
    }
  };
  c.executionCtx.waitUntil(cleanup().catch((err) => console.error("account cleanup", err)));

  await forgetPush(c.env, userId);
  await endAllSessions(c, userId);
  await endSession(c);
  return c.json({ ok: true, eventsDeleted: solo.length });
});
