// Cross-cutting checks on every main screen: no horizontal scroll, 44 px tap targets, axe accessibility,
// no console errors, in light and dark at 360, 390, 768 and 1280 px. Screenshots go to e2e-results/screens.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, openEvent, openSection } from "./helpers";
import { EV, type Role } from "./roles";
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

type Screen = { name: string; role: Role | null; go: (p: Page) => Promise<void> };

const SCREENS: Screen[] = [
  { name: "home", role: null, go: async (p) => void (await p.goto("/"), await p.locator(".card").first().waitFor()) },
  { name: "event-upcoming", role: "fanA", go: (p) => openEvent(p, EV.upcoming) },
  { name: "event-live", role: "fanA", go: (p) => openEvent(p, EV.live) },
  { name: "event-past", role: "fanA", go: (p) => openEvent(p, EV.past) },
  { name: "event-comments", role: "host", go: async (p) => (await openEvent(p, EV.live), await openSection(p, "comments"), await p.locator(".comments").waitFor()) },
  { name: "search", role: null, go: async (p) => (await p.goto("/"), await p.locator(".hs-search").click(), await p.getByRole("searchbox").fill("juno"), await p.locator(".search-item").first().waitFor()) },
  { name: "filters", role: null, go: async (p) => (await p.goto("/"), await p.locator(".hs-filters").click(), await p.getByText("Find your night.").waitFor()) },
  { name: "you-saved", role: "fanA", go: async (p) => (await p.goto("/"), await p.locator("button.avatar").click(), await p.getByRole("radio", { name: "Saved" }).click()) },
  { name: "you-notifications", role: "fanA", go: async (p) => (await p.goto("/"), await p.locator("button.avatar").click(), await p.getByRole("radio", { name: /Notifications/ }).click()) },
  { name: "you-profile", role: "fanA", go: async (p) => (await p.goto("/"), await p.locator("button.avatar").click(), await p.getByRole("radio", { name: "Profile" }).click()) },
  { name: "add-event", role: "host", go: async (p) => (await p.goto("/"), await p.getByRole("button", { name: /Add (an )?event/ }).click(), await p.getByPlaceholder("Wet Paint").waitFor()) },
  { name: "artist-page", role: null, go: async (p) => (await p.goto("/a/juno-ray"), await p.getByText("Juno Ray").first().waitFor()) },
  { name: "venue-page", role: null, go: async (p) => (await p.goto("/v/pulp"), await p.getByText("Pulp Warehouse").first().waitFor()) },
  { name: "sign-in", role: null, go: async (p) => (await p.goto("/"), await p.getByRole("button", { name: "Sign in" }).click(), await p.getByPlaceholder("you@example.com").waitFor()) },
  { name: "moderation", role: "mod", go: async (p) => (await p.goto("/"), await p.locator("button.avatar").click(), await p.getByRole("radio", { name: "Profile" }).click(), await p.getByRole("button", { name: "Review reports" }).click(), await p.locator("section[aria-label=Comments]").waitFor()) },
  { name: "terms", role: null, go: async (p) => void (await p.goto("/terms"), await p.getByRole("heading", { level: 1 }).waitFor()) },
];

const WIDTHS = [
  { w: 360, h: 780 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
];

/** Buttons and links smaller than 44 px, ignoring inline text links and small buttons whose ::after pads them to 44. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=radio], [role=tab], [role=menuitemradio], input[type=checkbox], select, summary");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest("[hidden], [aria-hidden=true], .sr-only")) continue;
      // Links and text buttons in running text are exempt (design review).
      if (style.display === "inline" || el.closest("p, .note, .policy-links")) continue;
      const after = getComputedStyle(el, "::after");
      const padded = after.content !== "none" && after.position === "absolute" ? Math.max(0, -parseFloat(after.top) || 0) * 2 : 0;
      const h = r.height + padded;
      const w = r.width + (after.content !== "none" && after.position === "absolute" ? Math.max(0, -parseFloat(after.left) || 0) * 2 : 0);
      if (Math.min(w, h) < 43.5) out.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").filter(Boolean).slice(0, 2).join(".")} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}" ${Math.round(w)}x${Math.round(h)}`);
    }
    return [...new Set(out)];
  });
}

for (const theme of ["dark", "light"] as const) {
  for (const size of WIDTHS) {
    test.describe(`${theme} ${size.w}px`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });
      for (const s of SCREENS) {
        test(`${s.name}`, async ({ as, problems }) => {
          const page = await as(s.role, { theme });
          await page.setViewportSize({ width: size.w, height: size.h });
          await s.go(page);
          await page.waitForTimeout(700);
          mkdirSync("e2e-results/screens", { recursive: true });
          await page.screenshot({ path: `e2e-results/screens/${theme}-${size.w}-${s.name}.png` });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          const small = theme === "dark" ? await smallTargets(page) : [];
          let axe: string[] = [];
          if (size.w === 390 || size.w === 1280) {
            const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).disableRules(["region"]).analyze();
            axe = res.violations
              .filter((v) => v.impact === "serious" || v.impact === "critical")
              .map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")} ${v.nodes[0]?.failureSummary?.split("\n")[1]?.trim() ?? ""}`.slice(0, 260));
          }
          // One file per screen: Playwright restarts its worker after a failing test, so nothing is kept in memory.
          writeFileSync(`e2e-results/screens/${theme}-${size.w}-${s.name}.json`, JSON.stringify({ overflow, small, axe, problems: [...problems] }, null, 1));
          expect.soft(overflow, "horizontal scroll (px)").toBeLessThanOrEqual(0);
          expect.soft(small, "tap targets under 44 px").toEqual([]);
          expect.soft(axe, "serious accessibility issues").toEqual([]);
          expect.soft(problems, "console or network errors").toEqual([]);
        });
      }
    });
  }
}

test("reduced motion: no running animations after load", async ({ as }) => {
  const page = await as("fanA", { reducedMotion: true });
  await page.goto("/");
  await page.locator(".card").first().waitFor();
  await page.locator(".card", { hasText: "E2E Live Night" }).click();
  await page.waitForTimeout(400);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 1 && (a.effect?.getComputedTiming().iterations ?? 1) !== Infinity).length,
  );
  expect(running).toBe(0);
  // GSAP writes inline transforms; with reduced motion the event page should be at rest, not mid-tween.
  const moving = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>(".event-title");
    const a = el?.getBoundingClientRect().top;
    await new Promise((r) => setTimeout(r, 200));
    return a !== el?.getBoundingClientRect().top;
  });
  expect(moving).toBe(false);
});
