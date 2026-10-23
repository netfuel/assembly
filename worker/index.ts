import { Hono } from "hono";
import type { AppContext } from "./env";
import { readSession } from "./session";
import { auth } from "./auth";
import { events } from "./events";
import type { City, Me } from "../shared/types";

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
    if (origin && origin !== new URL(c.env.APP_URL).origin) {
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

app.get("/me", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ user: null });
  const row = await c.env.DB.prepare("SELECT id, display_name, avatar_url, pronouns FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; display_name: string; avatar_url: string | null; pronouns: string | null }>();
  const user: Me | null = row ? { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, pronouns: row.pronouns } : null;
  c.header("Cache-Control", "private, no-store");
  return c.json({ user });
});

// Flyers and story cards stored in R2 (uploads arrive in the Core build phase).
app.get("/media/:key{.+}", async (c) => {
  const obj = await c.env.MEDIA.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

app.route("/auth", auth);
app.route("/events", events);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
});

export default app;
