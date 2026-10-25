// Flyer thumbnails as map pins. Each event with a thumbnail gets a framed square image registered
// with MapLibre as "thumb-<event id>". Images are drawn once and cached, and re-added after a
// theme switch (setStyle drops them). Events without one keep the dot underneath.
import type { Map as MapLibre } from "maplibre-gl";
import type { EventSummary } from "../../shared/types";

const SIZE = 72; // device pixels; shown at 36 css px with pixelRatio 2
const PAD = 4;

type Entry = { state: "loading" } | { state: "ready"; data: ImageData } | { state: "failed" };
const cache = new Map<string, Entry>();

export const thumbImageId = (eventId: string) => `thumb-${eventId}`;

async function draw(url: string, border: string, queer: boolean): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  // Hairline frame in the scene color, like the app's frames.
  ctx.fillStyle = border;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(PAD - 1, PAD - 1, SIZE - (PAD - 1) * 2, SIZE - (PAD - 1) * 2);
  ctx.drawImage(bitmap, PAD, PAD, SIZE - PAD * 2, SIZE - PAD * 2);
  // Queer-centered: a corner notch in the frame color, a shape cue that doesn't depend on seeing violet.
  if (queer) {
    ctx.fillStyle = border;
    ctx.beginPath();
    ctx.moveTo(SIZE, 0);
    ctx.lineTo(SIZE - 22, 0);
    ctx.lineTo(SIZE, 22);
    ctx.closePath();
    ctx.fill();
  }
  bitmap.close();
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/** Loads any missing thumbnails and adds them to the map. Safe to call repeatedly. */
export function syncThumbs(map: MapLibre, events: EventSummary[], colors: { uv: string; sodium: string }, onAdded: () => void) {
  for (const e of events) {
    if (!e.thumbUrl) continue;
    const id = thumbImageId(e.id);
    const entry = cache.get(id);
    if (entry?.state === "ready") {
      if (!map.hasImage(id)) map.addImage(id, entry.data, { pixelRatio: 2 });
      continue;
    }
    if (entry) continue; // loading or failed
    cache.set(id, { state: "loading" });
    draw(e.thumbUrl, e.scenes.includes("queer") ? colors.uv : colors.sodium, e.scenes.includes("queer"))
      .then((data) => {
        cache.set(id, { state: "ready", data });
        if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 });
        onAdded();
      })
      // Older flyers have no thumbnail: keep the dot.
      .catch(() => cache.set(id, { state: "failed" }));
  }
}

/** True when this event's thumbnail is drawn and ready to show. */
export function hasThumb(eventId: string) {
  return cache.get(thumbImageId(eventId))?.state === "ready";
}
