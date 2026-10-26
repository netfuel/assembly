import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { Features } from "../shared/types";

/** The beta modules from the design review. Each can be switched off without a deploy of new code. */
export function features(env: Pick<Env, "FEATURES_OFF">): Features {
  const off = new Set((env.FEATURES_OFF ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return { wall: !off.has("wall"), friends: !off.has("friends"), checkin: !off.has("checkin"), reactions: !off.has("reactions") };
}

/** Which module an API path belongs to, if any. Paths are as the API app sees them (no /api prefix). */
export function moduleFor(path: string): keyof Features | null {
  if (/^\/events\/[^/]+\/wall(\/|$)/.test(path) || path.startsWith("/wall/") || path.startsWith("/mod/wall")) return "wall";
  if (path.startsWith("/friends") || /^\/events\/[^/]+\/(friend-visibility|invite|invites|here)(\/|$)/.test(path)) return "friends";
  if (/^\/events\/[^/]+\/(checkin|presence|door-code)(\/|$)/.test(path)) return "checkin";
  if (/^\/events\/[^/]+\/react$/.test(path)) return "reactions";
  return null;
}

/** Turned-off modules answer 404 on every route, so nothing can reach them from an old client either. */
export const featureGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const m = moduleFor(new URL(c.req.url).pathname.replace(/^\/api/, ""));
  if (m && !features(c.env)[m]) return c.json({ error: "This feature is turned off." }, 404);
  await next();
};
