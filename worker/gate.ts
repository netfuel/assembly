import type { MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import type { GateState } from "../shared/types";

/**
 * The launch gate. While GATE is "on", the API answers 401 to anyone without a session, except the
 * routes a gated visitor needs: config, the interest form, sign-in, link previews' media, and health.
 * Everything under /api is denied by default; the list below is the whole allow-list. The pages outside
 * /api (link previews, feeds, policies, fonts) are not gated: a shared event still shows its card.
 *
 * Who gets through: only sign-ins whose email is on the list (MODERATORS, plus GATE_ALLOW for anyone
 * else who should see the app before launch). Everyone else who signs in is added to the interest list
 * and sent back to the gate without a session. Launch day is one variable change (GATE=off), no deploy.
 */
export function gateOn(env: Pick<Env, "GATE">): boolean {
  return (env.GATE ?? "off").trim().toLowerCase() === "on";
}

/** The emails that may pass the gate: MODERATORS and GATE_ALLOW, however the lists were typed. */
export function gateAllowList(env: Pick<Env, "MODERATORS" | "GATE_ALLOW">): string[] {
  return `${env.MODERATORS ?? ""} ${env.GATE_ALLOW ?? ""}`
    .split(/[\s,;]+/)
    .map((e) => e.replace(/["'<>\[\]]/g, "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function gateAllowsEmail(env: Pick<Env, "GATE" | "MODERATORS" | "GATE_ALLOW">, email: string | null | undefined): boolean {
  if (!gateOn(env)) return true;
  return !!email && gateAllowList(env).includes(email.trim().toLowerCase());
}

/** Whether this session may pass the gate: the gate is off, or one of the user's sign-in emails is listed. */
export async function gatePasses(env: Pick<Env, "GATE" | "MODERATORS" | "GATE_ALLOW" | "DB">, userId: string | null): Promise<boolean> {
  if (!gateOn(env)) return true;
  if (!userId) return false;
  const allowed = gateAllowList(env);
  if (!allowed.length) return false;
  const { results } = await env.DB.prepare("SELECT email FROM identities WHERE user_id = ? AND email IS NOT NULL").bind(userId).all<{ email: string }>();
  return results.some((r) => allowed.includes(r.email.toLowerCase()));
}

/** What /api/config tells the client: the gate as this visitor experiences it. */
export function gateFor(env: Pick<Env, "GATE">, passes: boolean): GateState {
  if (!gateOn(env)) return "off";
  return passes ? "off-for-you" : "on";
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
  if (!gateOn(c.env)) return next();
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  if (gatePublic(path, c.req.method)) return next();
  // A session from before the gate, or from an address that isn't listed, is gated like a visitor.
  if (await gatePasses(c.env, c.get("userId"))) return next();
  return c.json({ error: "Sign in first.", gate: "on" }, 401);
};
