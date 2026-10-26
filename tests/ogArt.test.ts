import { describe, expect, it } from "vitest";
import { artParams } from "../shared/flyerArt";
import { renderArtCpu } from "../shared/liquidCpu";
import { encodePng, upscale } from "../worker/png";
import { ogVersion } from "../worker/ogVersion";

describe("link-preview art", () => {
  it("draws only the event's inks, in every mode", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const p = artParams(`evt-${i}`);
      seen.add(p.mode);
      const px = renderArtCpu(p, 24, 30);
      expect(px.length).toBe(24 * 30 * 3);
      const inks = new Set(p.inks.map((c) => c.map((v) => Math.round(v * 255)).join(",")));
      for (let o = 0; o < px.length; o += 3) expect(inks.has(`${px[o]},${px[o + 1]},${px[o + 2]}`)).toBe(true);
    }
    expect(seen.size).toBe(6);
  });

  it("encodes a PNG with the right header and size", async () => {
    const rgb = upscale(new Uint8Array([255, 0, 0, 0, 255, 0]), 2, 1, 3);
    expect(rgb.length).toBe(6 * 3 * 3);
    const png = await encodePng(rgb, 6, 3, 3);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const v = new DataView(png.buffer);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([6, 3]);
  });

  it("changes the image version when what's drawn changes", async () => {
    const e = { title: "A", starts_at: "s", ends_at: "e", status: "live", neighborhood: null, flyer_key: null, venue_name: null, timezone: "America/Chicago", door_price: null, city_name: "Memphis" };
    const v = await ogVersion(e);
    expect(await ogVersion({ ...e })).toBe(v);
    expect(await ogVersion({ ...e, title: "B" })).not.toBe(v);
    expect(await ogVersion({ ...e, status: "cancelled" })).not.toBe(v);
  });
});
