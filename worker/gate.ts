import type { MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import type { GateState } from "../shared/types";

/**
 * The launch gate. While GATE is "on", the API answers 401 to anyone without a session, except the
 * routes a gated visitor needs: config, the interest form, sign-in, link previews' media, and health.
 * Everything under /api is denied by default; the list below is the whole allow-list. The pages outside
 * /api (link previews, feeds, policies, fonts) are not gated: a shared event still shows its card.
 * Launch day is one variable change (GATE=off), no deploy.
 */
export function gateOn(env: Pick<Env, "GATE">): boolean {
  return (env.GATE ?? "off").trim().toLowerCase() === "on";
}

/** What /api/config tells the client: the gate as this visitor experiences it. */
export function gateFor(env: Pick<Env, "GATE">, userId: string | null): GateState {
  if (!gateOn(env)) return "off";
  return userId ? "off-for-you" : "on";
}

/** API paths (without /api) a gated visitor may reach without a session. */
export function gatePublic(path: string, method: string): boolean {
  if (path === "/config" || path === "/health" || path === "/log") return true;
  if (path === "/interest" && method === "POST") return true;
  if (path.startsWith("/auth/")) return true;
  if (path.startsWith("/media/")) return true; // flyers for link previews
  if (path.startsWith("/og/")) return true; // link preview images
  return false;
}

export const launchGate: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!gateOn(c.env) || c.get("userId")) return next();
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  if (gatePublic(path, c.req.method)) return next();
  return c.json({ error: "Sign in first.", gate: "on" }, 401);
};
