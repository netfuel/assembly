// Friends on the map: up to three faces beside an event's pin, ringed in the live colour when a friend is there now.
// Never a person's own position: a face only ever sits on the event they're going to.
//
// Drawn by the map itself, not as page elements: each event's faces are one image registered with MapLibre and shown
// by a symbol layer from the same coordinates as the event dot, so they are rendered in the same pass and can't lag
// or drift away from the pin while the map moves. (Same approach as the flyer thumbnails in thumbPins.ts.)
import type { Map as MapLibre } from "maplibre-gl";
import type { EventSummary, FriendAt } from "../../shared/types";

export const FRIEND_SOURCE = "event-friends";
export const FRIEND_LAYER = "event-friends";

/** Below this zoom pins are clustered, so faces would float over nothing. */
const MIN_ZOOM = 12;
const PR = 2; // device pixels per css pixel
const FACE = 22 * PR;
const OVERLAP = 6 * PR;
const PAD = 3 * PR;
const MAX_FACES = 3;

type Colors = { live: string; fg: string; surface: string; line: string };
type Entry = { state: "loading" } | { state: "ready"; data: ImageData; w: number; h: number } | { state: "failed" };
const cache = new Map<string, Entry>();
const photos = new Map<string, Promise<ImageBitmap | null>>();

const imageId = (eventId: string, key: string) => `friends-${eventId}-${key}`;
const keyOf = (people: FriendAt[]) => people.map((p) => `${p.id}:${p.state}:${p.avatarUrl ?? ""}`).join("|");
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** A face's photo, or null when it can't be drawn (no photo, offline, or a host that blocks cross-origin reads). */
function photo(url: string | null) {
  if (!url) return Promise.resolve(null);
  let p = photos.get(url);
  if (!p) {
    p = fetch(url, { mode: "cors" })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => createImageBitmap(b))
      .catch(() => null);
    photos.set(url, p);
  }
  return p;
}

async function draw(people: FriendAt[], c: Colors) {
  const shown = people.slice(0, MAX_FACES);
  const extra = people.length - shown.length;
  const bitmaps = await Promise.all(shown.map((p) => photo(p.avatarUrl)));
  const moreW = extra > 0 ? 18 * PR : 0;
  const w = PAD * 2 + FACE + (shown.length - 1) * (FACE - OVERLAP) + moreW;
  const h = PAD * 2 + FACE;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // The pill.
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, h / 2);
  ctx.fillStyle = c.surface;
  ctx.fill();
  ctx.lineWidth = 1 * PR;
  ctx.strokeStyle = c.line;
  ctx.stroke();
  // Faces, left to right, each overlapping the one before it.
  shown.forEach((p, i) => {
    const cx = PAD + FACE / 2 + i * (FACE - OVERLAP);
    const cy = h / 2;
    const r = FACE / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = c.surface;
    ctx.fillRect(cx - r, cy - r, FACE, FACE);
    const bmp = bitmaps[i];
    if (bmp) ctx.drawImage(bmp, cx - r, cy - r, FACE, FACE);
    else {
      ctx.fillStyle = c.fg;
      ctx.font = `600 ${11 * PR}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.displayName.slice(0, 1).toUpperCase(), cx, cy + PR * 0.5);
    }
    ctx.restore();
    // Ring: the live colour when they're there now, otherwise the pill's own edge so overlapping faces separate.
    ctx.beginPath();
    ctx.arc(cx, cy, r - PR, 0, Math.PI * 2);
    ctx.lineWidth = 2 * PR;
    ctx.strokeStyle = p.state === "here" ? c.live : c.surface;
    ctx.stroke();
  });
  if (extra > 0) {
    ctx.fillStyle = c.line;
    ctx.font = `600 ${10 * PR}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${extra}`, PAD + FACE + (shown.length - 1) * (FACE - OVERLAP) + 3 * PR, h / 2 + PR * 0.5);
  }
  return { data: ctx.getImageData(0, 0, w, h), w, h };
}

/** Adds the friends source and layer. Called on every style load, so they come back after a theme switch. */
export function addFriendLayer(map: MapLibre) {
  map.addSource(FRIEND_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: FRIEND_LAYER,
    type: "symbol",
    source: FRIEND_SOURCE,
    minzoom: MIN_ZOOM,
    layout: {
      "icon-image": ["get", "img"],
      // Below and to the right of the pin, away from its title label above; clear of the flyer thumbnail once that
      // replaces the dot (zoom 13).
      "icon-anchor": "top-left",
      "icon-offset": ["step", ["zoom"], ["literal", [8, 6]], 13, ["case", ["get", "thumb"], ["literal", [22, 14]], ["literal", [8, 6]]]],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

/**
 * Draws any missing face images, registers them with the map (re-adding after a style change drops them), and points
 * the source at the events that have friends. Safe to call repeatedly: when the events, the friends, or the thumbnails
 * change, or after a style load.
 */
export function syncFriendFaces(
  map: MapLibre,
  events: EventSummary[],
  friends: Record<string, FriendAt[]>,
  colors: Colors,
  hasThumb: (eventId: string) => boolean,
) {
  const source = map.getSource(FRIEND_SOURCE) as unknown as { setData(d: GeoJSON.FeatureCollection): void } | undefined;
  if (!source) return;
  const features: GeoJSON.Feature[] = [];
  for (const e of events) {
    const people = friends[e.id];
    if (!people?.length) continue;
    const key = hash(keyOf(people) + colors.live);
    const id = imageId(e.id, key);
    const entry = cache.get(id);
    if (entry?.state === "ready") {
      if (!map.hasImage(id)) map.addImage(id, entry.data, { pixelRatio: PR });
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [e.lng, e.lat] }, properties: { id: e.id, img: id, thumb: hasThumb(e.id) } });
    } else if (!entry) {
      cache.set(id, { state: "loading" });
      draw(people, colors)
        .then((r) => {
          cache.set(id, { state: "ready", ...r });
          syncFriendFaces(map, events, friends, colors, hasThumb);
        })
        .catch(() => cache.set(id, { state: "failed" }));
    }
  }
  source.setData({ type: "FeatureCollection", features });
}
