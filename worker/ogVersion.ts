// The version of an event's link-preview image (worker/ogImage.ts). Kept apart from the renderer so the page
// route (worker/og.ts) can build the image URL without loading any wasm.

/** Bump when the design changes, so cached images are drawn again. */
export const OG_DESIGN = 1;

export type OgRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  neighborhood: string | null;
  flyer_key: string | null;
  venue_name: string | null;
  timezone: string;
  door_price: string | null;
  city_name: string;
};

/** Changes whenever anything drawn on the image changes, so the URL (and the stored file) changes with it. */
export async function ogVersion(e: Omit<OgRow, "id" | "city_name"> & { city_name?: string }): Promise<string> {
  const key = JSON.stringify([OG_DESIGN, e.title, e.starts_at, e.ends_at, e.status, e.neighborhood, e.flyer_key, e.venue_name, e.timezone, e.door_price, e.city_name]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

