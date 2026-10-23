import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { rateLimit } from "./posting";
import { sniffImage } from "./validate";

export const FLYER_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 90;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // Stream's limit for basic (non-resumable) uploads
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

export function streamConfigured(env: Env) {
  return !!(env.CLOUDFLARE_ACCOUNT_ID && env.STREAM_API_TOKEN);
}

async function streamApi(env: Env, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.STREAM_API_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: { message: string }[] };
  if (!res.ok || !body.success) throw new Error(body.errors?.map((e) => e.message).join("; ") || `Stream ${res.status}`);
  return body.result;
}

export const uploads = new Hono<AppContext>();

/** The client sends the image bytes as the request body (already resized in the browser). */
uploads.post("/flyer", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to upload a flyer." }, 401);
  if (!(await rateLimit(c.env.SESSIONS, `upload:${userId}`, 30, 3600))) {
    return c.json({ error: "That's a lot of uploads in an hour. Try again a little later." }, 429);
  }
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > FLYER_MAX_BYTES) return c.json({ error: "Flyers can be up to 10 MB." }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > FLYER_MAX_BYTES) return c.json({ error: "Flyers can be up to 10 MB." }, 413);
  const type = sniffImage(bytes);
  if (!type) return c.json({ error: "Use a JPG, PNG, or WebP image." }, 415);

  const key = `flyers/${userId}/${crypto.randomUUID()}.${type}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: CONTENT_TYPES[type], cacheControl: "public, max-age=31536000, immutable" } });
  return c.json({ key, url: `/api/media/${key}` }, 201);
});

/** Returns a one-time Stream upload URL capped at 90 seconds. The browser uploads the file straight to Stream. */
uploads.post("/video", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to upload a video." }, 401);
  if (!streamConfigured(c.env)) return c.json({ error: "Video uploads aren't set up on this server yet." }, 503);
  if (!(await rateLimit(c.env.SESSIONS, `video:${userId}`, 10, 3600))) {
    return c.json({ error: "That's a lot of videos in an hour. Try again a little later." }, 429);
  }
  const body = await c.req.json<{ seconds?: number; bytes?: number }>().catch(() => ({}) as { seconds?: number; bytes?: number });
  if (typeof body.seconds === "number" && body.seconds > VIDEO_MAX_SECONDS + 0.5) {
    return c.json({ error: "Promo videos can be up to 1:30. Trim it and try again." }, 400);
  }
  if (typeof body.bytes === "number" && body.bytes > VIDEO_MAX_BYTES) {
    return c.json({ error: "That file is over 200 MB. Export it smaller and try again." }, 413);
  }
  try {
    const result = (await streamApi(c.env, "/direct_upload", {
      method: "POST",
      // Stream enforces the cap: longer uploads fail processing.
      body: JSON.stringify({ maxDurationSeconds: VIDEO_MAX_SECONDS, creator: userId, meta: { app: "assembly" } }),
    })) as { uploadURL: string; uid: string };
    // Remember who uploaded it, so only they can attach it to an event.
    await c.env.SESSIONS.put(`video:${result.uid}`, userId, { expirationTtl: 60 * 60 * 24 * 7 });
    return c.json({ uploadURL: result.uploadURL, uid: result.uid });
  } catch (err) {
    console.error("stream direct_upload failed", err);
    return c.json({ error: "Video upload isn't available right now. Post without it and add it later." }, 502);
  }
});

uploads.get("/video/:uid", async (c) => {
  const uid = c.req.param("uid");
  if (!/^[a-f0-9]{32}$/.test(uid)) return c.json({ error: "Not found." }, 404);
  if (!streamConfigured(c.env)) return c.json({ error: "Video isn't set up on this server." }, 503);
  try {
    const v = (await streamApi(c.env, `/${uid}`)) as {
      readyToStream: boolean;
      status?: { state?: string; errorReasonCode?: string };
      duration?: number;
      thumbnail?: string;
    };
    const state = v.readyToStream ? "ready" : v.status?.state === "error" ? "error" : "processing";
    const message =
      state === "error"
        ? v.status?.errorReasonCode === "ERR_DURATION_EXCEED_CONSTRAINT"
          ? "That video is longer than 1:30. Trim it and upload again."
          : "That video couldn't be processed. Try another file."
        : null;
    c.header("Cache-Control", "no-store");
    return c.json({ state, message, duration: v.duration ?? null, thumbnail: v.thumbnail ?? null });
  } catch {
    return c.json({ state: "processing", message: null });
  }
});
