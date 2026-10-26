// Globals the link-preview libraries expect, set before they load (imported first by worker/ogRender.ts).
// satori's layout loader reads self.location.href as soon as it's imported when it sees a worker scope, and
// Workers have no location; jsquash's WebP decoder builds an ImageData, which Workers don't have either.
for (const scope of [globalThis, (globalThis as { self?: object }).self]) {
  if (scope && !(scope as { location?: unknown }).location) {
    Object.defineProperty(scope, "location", { value: { href: "https://assembly.rsvp/" }, configurable: true });
  }
}
const g = globalThis as { ImageData?: unknown };
g.ImageData ??= class {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
};
export {};
