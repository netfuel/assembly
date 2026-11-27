// Renders the iOS app icon and launch image from public/icons/favicon.svg (made by scripts/make-icons.py).
// Run: node scripts/make-ios-assets.mjs   (after changing the mark; the outputs are committed)
//
// - App icon: 1024 x 1024, square and opaque (iOS rounds the corners itself and rejects transparency).
// - Launch image: the ground colour only. The web splash (index.html) draws the A as soon as the page loads,
//   so a mark here would show twice.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = `${root}ios/App/App/Assets.xcassets`;
const GROUND = "#0a0a0b";

await initWasm(await readFile(`${root}node_modules/@resvg/resvg-wasm/index_bg.wasm`));

// resvg only writes RGBA, and App Store validation rejects an app icon with an alpha channel even when every
// pixel is opaque. So the pixels are re-encoded here as an 8-bit RGB PNG.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
function rgbPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1); // first byte of each row: filter type 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[row + 1 + x * 3] = rgba[i];
      raw[row + 2 + x * 3] = rgba[i + 1];
      raw[row + 3 + x * 3] = rgba[i + 2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour (RGB), deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const render = (svg, width) => {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: GROUND }).render();
  return rgbPng(img.width, img.height, img.pixels);
};

const mark = await readFile(`${root}public/icons/favicon.svg`, "utf8");
// Full-bleed square: drop the favicon's rounded corners.
const square = mark.replace(/<rect([^>]*?)\srx="[^"]*"/, "<rect$1");
if (square === mark) throw new Error("favicon.svg changed shape: expected a rounded <rect> ground to square off.");
await writeFile(`${assets}/AppIcon.appiconset/AppIcon-512@2x.png`, render(square, 1024));

const ground = `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="${GROUND}"/></svg>`;
const launch = render(ground, 2732);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await writeFile(`${assets}/Splash.imageset/${name}`, launch);
}
console.log("iOS icon and launch image written.");
