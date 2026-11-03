import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripMetadata } from "../worker/stripMeta";

const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));
const fixture = (n: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", n)));

// Checks the result still opens as an image, when Python with Pillow is around to check it.
function decodes(b: Uint8Array, ext: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "strip-"));
  const p = join(dir, `x.${ext}`);
  writeFileSync(p, b);
  try {
    execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).load()", p], { stdio: "pipe" });
    return true;
  } catch (e) {
    return /No module named|ENOENT/.test(String((e as { stderr?: Buffer }).stderr ?? e));
  }
}

describe("stripMetadata", () => {
  it("removes EXIF from a JPEG and keeps it decodable", () => {
    const src = fixture("meta.jpg");
    expect(has(src, "TestCameraMaker")).toBe(true);
    const out = stripMetadata(src, "jpg");
    expect(has(out, "TestCameraMaker")).toBe(false);
    expect(has(out, "Exif")).toBe(false);
    expect(decodes(out, "jpg")).toBe(true);
  });
  it("removes text and EXIF chunks from a PNG", () => {
    const src = fixture("meta.png");
    expect(has(src, "TestPngText")).toBe(true);
    const out = stripMetadata(src, "png");
    expect(has(out, "TestPngText")).toBe(false);
    expect(has(out, "TestCameraMaker")).toBe(false);
    expect(decodes(out, "png")).toBe(true);
  });
  it("removes EXIF and XMP from a WebP and fixes the header", () => {
    const src = fixture("meta.webp");
    expect(has(src, "TestCameraMaker") && has(src, "TestXMP")).toBe(true);
    const out = stripMetadata(src, "webp");
    expect(has(out, "TestCameraMaker") || has(out, "TestXMP")).toBe(false);
    expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true)).toBe(out.length - 8);
    expect(decodes(out, "webp")).toBe(true);
  });
  it("leaves files it can't parse unchanged", () => {
    const junk = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]);
    expect(stripMetadata(junk, "jpg")).toBe(junk);
  });
});
