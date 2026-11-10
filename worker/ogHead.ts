// Shared by every server-rendered preview route (events, artists, venues, organizers, cities, scenes): builds the
// Open Graph / Twitter tag set and swaps it into the app's index.html. Plain string work (no HTMLRewriter), so
// tests/previews.test.ts runs the same code under Node.

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The size a large-image card is drawn at (worker/ogImage.ts, public/icons/og.png). */
export const OG_W = 1200;
export const OG_H = 630;

export interface PreviewMeta {
  /** Page title without the site suffix. */
  title: string;
  description: string;
  /** Absolute https URL of the page itself; also the canonical. */
  url: string;
  /** Absolute https URL of the preview image, and its real size. */
  image: string;
  imageWidth: number;
  imageHeight: number;
  imageAlt: string;
  ogType?: string;
  /** Hidden, deleted, or unknown pages: kept out of search results. */
  noindex?: boolean;
  /** Extra head markup (JSON-LD, feed links), already escaped. */
  extra?: string;
}

/** Make a URL absolute against the request's origin; anything that isn't http(s) falls back to `fallback`. */
export function absolute(u: string, origin: string, fallback: string): string {
  try {
    const url = new URL(u, origin);
    if (url.protocol === "http:" && new URL(origin).protocol === "https:") url.protocol = "https:";
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function metaTags(m: PreviewMeta): string {
  return [
    `<meta property="og:type" content="${esc(m.ogType ?? "website")}">`,
    `<meta property="og:site_name" content="Assembly">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.url)}">`,
    `<meta property="og:image" content="${esc(m.image)}">`,
    `<meta property="og:image:width" content="${m.imageWidth}">`,
    `<meta property="og:image:height" content="${m.imageHeight}">`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${esc(m.image)}">`,
    `<meta name="twitter:image:alt" content="${esc(m.imageAlt)}">`,
    `<link rel="canonical" href="${esc(m.url)}">`,
    ...(m.noindex ? [`<meta name="robots" content="noindex">`] : []),
    m.extra ?? "",
  ].join("");
}

/** The app's HTML with this page's title, description and tags in place of the site defaults. */
export function rewriteHead(html: string, m: PreviewMeta): string {
  const out = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)} · Assembly</title>`)
    .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>/gi, `<meta name="description" content="${esc(m.description)}">`)
    // The page's default preview tags give way to this page's.
    .replace(/<meta\b[^>]*\b(?:property=["']og:|name=["']twitter:|name=["']robots["'])[^>]*>/gi, "")
    .replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi, "");
  return out.includes("</head>") ? out.replace("</head>", `${metaTags(m)}</head>`) : out + metaTags(m);
}

/** The app page with only "keep this out of search" applied: unknown, hidden or deleted pages. */
export function noindexHtml(html: string): string {
  const out = html.replace(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi, "");
  const tag = `<meta name="robots" content="noindex">`;
  return out.includes("</head>") ? out.replace("</head>", `${tag}</head>`) : out + tag;
}

/** Width and height from the first bytes of a PNG, JPEG or WebP (what we accept as uploads), else null. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length >= 30 && b[0] === 0x52 && b[8] === 0x57) {
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fmt === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (fmt === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (fmt === "VP8L") {
      const v = dv.getUint32(21, true);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}

/** An HTML response made from the app page's headers, minus the ones that describe the original bytes. */
export function htmlResponse(html: string, page: Response, opts: { noindex?: boolean } = {}): Response {
  const headers = new Headers(page.headers);
  for (const h of ["Content-Length", "Content-Encoding", "ETag"]) headers.delete(h);
  headers.set("Cache-Control", "public, max-age=60");
  if (opts.noindex) headers.set("X-Robots-Tag", "noindex");
  return new Response(html, { status: page.status, headers });
}
