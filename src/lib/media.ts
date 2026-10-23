// Browser-side media prep for the posting form.

export const FLYER_MAX_EDGE = 2000;
export const FLYER_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 90;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export class MediaError extends Error {}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize a flyer so its long edge is at most 2000 px and re-encode it.
 * Re-encoding also drops the photo's metadata (GPS location, camera details) before it leaves the device.
 */
export async function prepareFlyer(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!/^image\/(jpeg|png|webp|heic|heif|avif|gif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)) {
    throw new MediaError("Use a JPG, PNG, or WebP image.");
  }
  if (file.size > 40 * 1024 * 1024) throw new MediaError("That image is over 40 MB. Export a smaller copy.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new MediaError("This browser can't read that image. Try a JPG or PNG.");
  }
  const scale = Math.min(1, FLYER_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MediaError("Couldn't prepare that image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // WebP where the browser can encode it (Safari can't), JPEG otherwise.
  let blob = await canvasToBlob(canvas, "image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.86);
  if (!blob) throw new MediaError("Couldn't prepare that image.");
  if (blob.size > FLYER_MAX_BYTES) throw new MediaError("That flyer is still over 10 MB after resizing.");
  return { blob, width, height };
}

/** Reads a video's length from its metadata without uploading it. */
export function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = () => URL.revokeObjectURL(url);
    v.onloadedmetadata = () => {
      done();
      resolve(v.duration);
    };
    v.onerror = () => {
      done();
      reject(new MediaError("This browser can't read that video. Try an MP4 or MOV."));
    };
    v.src = url;
  });
}

/** Uploads straight to Cloudflare Stream's one-time URL, reporting progress from 0 to 1. */
export function uploadToStream(uploadURL: string, file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new MediaError("The video upload didn't finish. Try again.")));
    xhr.onerror = () => reject(new MediaError("The video upload lost its connection. Try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.open("POST", uploadURL);
    xhr.send(form);
  });
}

export function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
