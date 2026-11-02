// Your location stays on the phone: no request carries your coordinates, during map use or check-in.
import { test, expect, openEvent } from "./helpers";
import { EV, VENUE } from "./roles";

test("coordinates never leave the phone", async ({ as }) => {
  // Distinctive digits so a leak is easy to spot.
  const geo = { latitude: VENUE.lat + 0.000317, longitude: VENUE.lng - 0.000291 };
  const page = await as("fanB", { geo });
  const sent: string[] = [];
  page.on("request", (r) => sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
  await page.goto("/");
  // With location allowed the map already follows you; tap the locate control anyway so the app reads it again.
  await page.locator("button.locate").click();
  await page.waitForTimeout(2500);
  await openEvent(page, EV.live);
  await page.locator(".ev-bar-primary").click();
  await expect(page.locator(".checkin-stamp")).toBeVisible();
  await page.getByRole("button", { name: "Check out" }).click();
  const digits = [geo.latitude.toFixed(4), geo.longitude.toFixed(4), String(geo.latitude).slice(0, 7), String(geo.longitude).slice(0, 8)];
  const leaks = sent.filter((s) => digits.some((d) => s.includes(d)));
  expect(leaks, leaks.join("\n")).toEqual([]);
  // Nothing personal in query strings either.
  expect(sent.filter((s) => /[?&](email|lat|lng|lon)=/.test(s.split(" ")[1] ?? ""))).toEqual([]);
});
