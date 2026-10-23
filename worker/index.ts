import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { readSession } from "./session";
import { profile } from "./profile";
import { auth } from "./auth";
import { events } from "./events";
import { fonts } from "./fonts";
import { posting } from "./posting";
import { streamConfigured, uploads } from "./uploads";
import type { City } from "../shared/types";

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

// What this server supports, so the app can show or hide features.
app.get("/config", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ video: streamConfigured(c.env), streamCustomerCode: c.env.STREAM_CUSTOMER_CODE ?? null });
});

// Flyers and profile photos stored in R2. Only those prefixes are public; fonts and anything else in the bucket are not.
app.get("/media/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!(key.startsWith("flyers/") || key.startsWith("avatars/")) || key.includes("..")) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

app.route("/auth", auth);
app.route("/me", profile);
app.route("/uploads", uploads);
app.route("/", posting);
app.route("/events", events);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
});

// Fonts live outside /api; everything else the Worker handles is under /api.
const root = new Hono<{ Bindings: Env }>();
root.route("/fonts", fonts);
root.route("/", app);

export default root;
