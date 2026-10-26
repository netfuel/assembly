import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { readSession } from "./session";
import { profile } from "./profile";
import { moderation } from "./moderation";
import { push, pushConfigured } from "./push";
import { startingSoon } from "./notify";
import { auth } from "./auth";
import { emailAuth } from "./emailAuth";
import { events } from "./events";
import { fonts } from "./fonts";
import { og } from "./og";
import { ogPages } from "./ogPages";
import { ogImages } from "./ogImage";
import { feeds, sitemap } from "./feeds";
import { searchRoute } from "./search";
import { checkins } from "./checkins";
import { eventWall, wallModeration, wallPosts } from "./wall";
import { eventFriendVisibility, friends } from "./friends";
import { withSecurityHeaders } from "./security";
import { posting, rateLimit } from "./posting";
import { streamConfigured, uploads } from "./uploads";
import type { City } from "../shared/types";
import { featureGate, features } from "./features";
import { pageModeration, pages } from "./pages";
import { live } from "./live";
import { inbox } from "./inbox";
import { reactions } from "./reactions";
import { blocks, commentActions, commentModeration, eventComments } from "./comments";

const app = new Hono<AppContext>().basePath("/api");

// Who is signed in, for every request.
app.use("*", async (c, next) => {
  c.set("userId", await readSession(c));
  await next();
});

// Block cross-site writes. Apple's sign-in callback is the one cross-site POST we accept.
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !c.req.path.startsWith("/api/auth/apple/callback")) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Cross-site request blocked." }, 403);
    }
  }
  await next();
});

// Beta modules switched off with FEATURES_OFF answer 404.
app.use("*", featureGate);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/cities/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, name, timezone, center_lat, center_lng, default_zoom FROM cities WHERE slug = ?",
  )
    .bind(c.req.param("slug"))
    .first<{ id: string; name: string; timezone: string; center_lat: number; center_lng: number; default_zoom: number }>();
  if (!row) return c.json({ error: "That city isn't on Assembly yet." }, 404);
  const city: City = { id: row.id, name: row.name, timezone: row.timezone, center: [row.center_lng, row.center_lat], zoom: row.default_zoom };
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(city);
});

// Errors from people's browsers, so they show up in Workers Logs next to server errors.
app.post("/log", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c.env.SESSIONS, `log:${ip}`, 20, 3600))) return c.body(null, 204);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  console.error("client error", {
    message: clip(body.message, 500),
    stack: clip(body.stack, 2000),
    path: clip(body.path, 200),
    ua: clip(c.req.header("User-Agent"), 200),
    signedIn: !!c.get("userId"),
  });
  return c.body(null, 204);
});

// What this server supports, so the app can show or hide features.
app.get("/config", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    video: streamConfigured(c.env),
    streamCustomerCode: c.env.STREAM_CUSTOMER_CODE ?? null,
    push: pushConfigured(c.env),
    vapidPublicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null,
    features: features(c.env),
  });
});

// Flyers and profile photos stored in R2. Only those prefixes are public; fonts and anything else in the bucket are not.
app.get("/media/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!(key.startsWith("flyers/") || key.startsWith("avatars/") || key.startsWith("pages/")) || key.includes("..")) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

app.route("/auth/email", emailAuth);
app.route("/auth", auth);
app.route("/me/inbox", inbox);
app.route("/me/blocks", blocks);
app.route("/me", profile);
app.route("/uploads", uploads);
app.route("/", posting);
app.route("/", moderation);
app.route("/push", push);
app.route("/events", checkins);
app.route("/events", live);
app.route("/events", reactions);
app.route("/events", eventComments);
app.route("/comments", commentActions);
app.route("/events", eventFriendVisibility);
app.route("/friends", friends);
app.route("/events", eventWall);
app.route("/wall", wallPosts);
app.route("/", wallModeration);
app.route("/", commentModeration);
app.route("/events", events);
app.route("/search", searchRoute);
app.route("/pages", pages);
app.route("/", pageModeration);
app.route("/og", ogImages);

app.notFound((c) => c.json({ error: "Not found." }, 404));
// Log the real error (it shows in Workers Logs and wrangler tail) and answer in JSON like every other route.
app.onError((err, c) => {
  console.error("api error", c.req.method, c.req.path, err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err));
  return c.json({ error: "Something went wrong on our end. Try again in a minute." }, 500);
});
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
});

// Fonts live outside /api; everything else the Worker handles is under /api.
const root = new Hono<{ Bindings: Env }>();
// Security headers on everything the Worker answers (static files get them from public/_headers).
root.use("*", async (c, next) => {
  await next();
  // Vite's dev server defines import.meta.env.DEV. Production is bundled by wrangler, where
  // import.meta.env doesn't exist, so read it defensively: anything but true means production.
  try {
    c.res = withSecurityHeaders(c.res, import.meta.env?.DEV === true);
  } catch (err) {
    // Never take the site down over headers: log it and send the response as is.
    console.error("security headers failed", c.req.path, err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err));
  }
});
root.onError((err, c) => {
  console.error("worker error", c.req.method, c.req.path, err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err));
  return c.json({ error: "Something went wrong on our end. Try again in a minute." }, 500);
});
root.route("/fonts", fonts);
root.route("/e", og);
root.route("/", ogPages);
root.route("/feeds", feeds);
root.get("/sitemap.xml", sitemap);
root.route("/", app);

export default {
  fetch: root.fetch,
  /** Cron (wrangler.jsonc triggers): starting-soon reminders every 15 minutes. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(startingSoon(env).catch((err) => console.error("starting soon", err)));
  },
} satisfies ExportedHandler<Env>;
