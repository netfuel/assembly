// Checks the link-preview tags on each page type: an event (/e), an artist (/a), a venue (/v) and an organizer (/o).
// Every page needs a title, description, canonical URL and Open Graph tags with absolute URLs; images must load,
// be a real image under 5 MB, and (for the designed 1200 x 630 previews) say their size.
//   npm run check:tags                      against the local dev server (http://localhost:5173)
//   npm run check:tags -- https://assembly.rsvp   against production
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const https = base.startsWith("https://");
let failed = false;
const fail = (path, msg) => {
  failed = true;
  console.log(`FAIL ${path}: ${msg}`);
};

const json = async (path) => {
  const r = await fetch(base + path, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
};

/** Pick one real example of each page type from the API. */
async function examples() {
  const { events } = await json("/api/events");
  const e = events.find((x) => !x.isSample && x.status === "live") ?? events[0];
  if (!e) throw new Error("no events to check");
  const d = await json(`/api/events/${encodeURIComponent(e.id)}`);
  // An event with a lineup, venue and host, if there is one in the first few.
  let rich = d;
  for (const x of events.slice(0, 15)) {
    if (rich.lineup?.length && rich.venueSlug && rich.host?.slug) break;
    rich = await json(`/api/events/${encodeURIComponent(x.id)}`);
  }
  const out = [{ path: `/e/${encodeURIComponent(e.id)}`, image: true, size: true }];
  const artist = rich.lineup?.[0]?.slug ?? d.lineup?.[0]?.slug;
  if (artist) out.push({ path: `/a/${encodeURIComponent(artist)}` });
  const venue = rich.venueSlug ?? d.venueSlug;
  if (venue) out.push({ path: `/v/${encodeURIComponent(venue)}` });
  const org = rich.host?.slug ?? d.host?.slug;
  if (org) out.push({ path: `/o/${encodeURIComponent(org)}` });
  out.push({ path: "/", image: true });
  return out;
}

const attr = (html, re) => html.match(re)?.[1]?.replace(/&amp;/g, "&");
const meta = (html, prop) => attr(html, new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));

async function check({ path, image, size }) {
  const r = await fetch(base + path, { redirect: "manual" });
  if (r.status !== 200) return fail(path, `status ${r.status}`);
  const html = await r.text();
  const title = attr(html, /<title>([^<]+)<\/title>/);
  if (!title || title === "Assembly" && path !== "/") fail(path, `title is "${title ?? ""}"`);
  for (const p of ["og:title", "og:description", "og:url", "og:site_name", "twitter:card"]) if (!meta(html, p)) fail(path, `missing ${p}`);
  if (path !== "/" && !attr(html, /<link rel="canonical" href="([^"]+)"/)) fail(path, "missing canonical link");
  for (const p of ["og:url", "og:image"]) {
    const v = meta(html, p);
    if (v && !/^https?:\/\//.test(v)) fail(path, `${p} isn't absolute: ${v}`);
    if (v && https && !v.startsWith("https://")) fail(path, `${p} isn't https: ${v}`);
  }
  const img = meta(html, "og:image");
  if (image && !img) fail(path, "missing og:image");
  if (img) {
    if (size && (meta(html, "og:image:width") !== "1200" || meta(html, "og:image:height") !== "630")) fail(path, "og:image size tags aren't 1200 x 630");
    if (!meta(html, "og:image:alt")) fail(path, "missing og:image:alt");
    // Fetch it from this server, whatever host the tag names (local checks of production-style URLs).
    const u = new URL(img);
    const ir = await fetch(base + u.pathname + u.search);
    const type = ir.headers.get("content-type") ?? "";
    const bytes = (await ir.arrayBuffer()).byteLength;
    if (!ir.ok) fail(path, `og:image ${ir.status}`);
    else if (!type.startsWith("image/")) fail(path, `og:image is ${type}, not an image`);
    else if (bytes > 5 * 1024 * 1024) fail(path, `og:image is ${(bytes / 1048576).toFixed(1)} MB`);
  }
  if (path.match(/^\/[eavo]\//) && !html.includes('type="application/ld+json"')) fail(path, "missing JSON-LD");
  if (!failed) console.log(`ok   ${path}  ${title}`);
}

try {
  for (const ex of await examples()) {
    const before = failed;
    failed = false;
    await check(ex);
    failed = failed || before;
  }
} catch (err) {
  fail("setup", err.message);
}
process.exit(failed ? 1 : 0);
