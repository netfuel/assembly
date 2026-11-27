import type { MiddlewareHandler } from "hono";

/**
 * The iOS app (Capacitor, docs/ios.md) runs the web app at capacitor://localhost and calls this Worker across
 * origins. Browsers set Origin themselves, so a web page can't claim to be the app; a script outside a browser
 * can claim anything, but it has no one's session cookie either.
 */
export const APP_ORIGINS: ReadonlySet<string> = new Set(["capacitor://localhost"]);

export const isAppOrigin = (origin: string | null | undefined): origin is string => !!origin && APP_ORIGINS.has(origin);

const PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
  "Access-Control-Max-Age": "86400",
};

/** CORS for the app's origin only. Every other origin gets exactly what it got before (no CORS headers). */
export const appCors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("Origin");
  if (!isAppOrigin(origin)) {
    await next();
    return;
  }
  const allow = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" };
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...allow, ...PREFLIGHT } });
  await next();
  // Some responses (static assets, R2 bodies) arrive with read-only headers: copy before adding to them.
  const res = new Response(c.res.body, c.res);
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.append("Vary", "Origin");
  c.res = res;
};

/**
 * Blocks cross-site writes: a POST from another site's page carrying someone's cookie. The site itself and the
 * app pass. Apple's sign-in callback is the one cross-site POST accepted (Apple posts the form back).
 */
export const blockCrossSiteWrites: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !c.req.path.startsWith("/api/auth/apple/callback")) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin && !isAppOrigin(origin)) {
      return c.json({ error: "Cross-site request blocked." }, 403);
    }
  }
  await next();
};
