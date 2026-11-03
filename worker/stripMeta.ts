// Removes location, camera and other metadata from uploaded images without re-encoding them.
// The app already strips this in the browser; this covers anything sent to the API directly.
//   JPEG: drops APP1 (EXIF, XMP), APP3–APP13, APP15 and comments. Keeps APP0 (JFIF), APP2 (ICC colour) and APP14 (Adobe).
//   PNG: drops eXIf, tEXt, zTXt, iTXt and tIME chunks.
//   WebP: drops EXIF and XMP chunks and clears their flags in VP8X.
// Anything it can't parse is returned unchanged rather than rejected (sniffImage has already checked the type).

export function stripMetadata(bytes: Uint8Array, type: "jpg" | "png" | "webp"): Uint8Array {
  try {
    if (type === "jpg") return stripJpeg(bytes);
    if (type === "png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return bytes;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // not a marker where one should be: leave the file alone
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      parts.push(b.subarray(i)); // start of scan (or end): the rest is image data
      return concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return b;
    const drop = marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return b;
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = view.getUint32(i);
    const name = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) return b;
    if (!PNG_DROP.has(name)) parts.push(b.subarray(i, end));
    i = end;
    if (name === "IEND") break;
  }
  return concat(parts);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const name = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = view.getUint32(i + 4, true);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) return b;
    if (name === "VP8X") {
      const c = b.slice(i, Math.min(end, b.length));
      c[8] &= ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
      chunks.push(c);
    } else if (name !== "EXIF" && name !== "XMP ") chunks.push(b.subarray(i, Math.min(end, b.length)));
    i = end;
  }
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return concat([head, body]);
}
