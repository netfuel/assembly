// Security headers. The same policy goes on Worker responses (API, event pages) and, via
// public/_headers, on static files. npm run headers writes _headers from this file; before every
// build, scripts/sync-theme-hash.mjs recomputes THEME_SCRIPT_HASH from index.html in both places.
// tests/security.test.ts fails if they drift.

/** Hash of the inline theme script in index.html (it sets light or dark before first paint). */
export const THEME_SCRIPT_HASH = "'sha256-Jmm4CheuVPsGb2cBeZcc9p4HcDAB2hAGjh0EGr4yM6E='";

const STREAM = ["https://iframe.videodelivery.net", "https://videodelivery.net", "https://upload.videodelivery.net", "https://*.cloudflarestream.com"];

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${THEME_SCRIPT_HASH} https://static.cloudflareinsights.com`,
  // MapLibre and React set inline styles.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.googleusercontent.com ${STREAM.join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self' https://tiles.openfreemap.org https://cloudflareinsights.com ${STREAM.join(" ")}`,
  `frame-src ${STREAM.join(" ")}`,
  `media-src 'self' blob: ${STREAM.join(" ")}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * Adds the headers to a response, leaving ones it already set alone. `dev` skips the content policy:
 * Vite's dev server injects inline scripts (hot reload) that the policy rightly blocks.
 */
export function withSecurityHeaders(res: Response, dev = false): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (dev && k === "Content-Security-Policy") continue;
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}
