import { test as base, expect, request, type APIRequestContext, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BASE, type Role } from "./roles";

export const ids = (): Record<Role, string> => JSON.parse(readFileSync("e2e/.auth/ids.json", "utf8"));

/** Console errors that come from the test container, not the app: blocked map tiles and fonts. */
const NOISE = /openfreemap|ERR_TUNNEL|ERR_CONNECTION|glyph|tiles\.|Failed to load resource: net::/i;

/** 4xx answers the app asks for on purpose (signed-out me, feature probes). Everything else is a finding. */
const EXPECTED_4XX = /^\/api\/(me|friends|me\/inbox)$|^\/fonts\/timeless\//;

type Fixtures = {
  /** Errors seen on the page during the test: console errors, page errors, failed or 5xx API calls. */
  problems: string[];
  as: (role: Role | null, opts?: { theme?: "light" | "dark"; geo?: { latitude: number; longitude: number; accuracy?: number } | "denied"; reducedMotion?: boolean }) => Promise<Page>;
  api: (role: Role | null) => Promise<APIRequestContext>;
};

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => {
    await use([]);
  },
  as: async ({ browser, problems }, use, info) => {
    const contexts: BrowserContext[] = [];
    await use(async (role, opts = {}) => {
      const ctx = await browser.newContext({
        ...info.project.use,
        storageState: role ? `e2e/.auth/${role}.json` : undefined,
        geolocation: opts.geo && opts.geo !== "denied" ? { accuracy: 30, ...opts.geo } : undefined,
        permissions: opts.geo && opts.geo !== "denied" ? ["geolocation"] : [],
        reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
      });
      contexts.push(ctx);
      await ctx.addInitScript((theme) => {
        try {
          localStorage.setItem("assembly-theme-choice", theme);
          // Skip first-run sheets so they don't cover what's under test.
          localStorage.setItem("assembly:install-welcomed", "1");
          localStorage.setItem("assembly:install-dismissed", "1");
        } catch {}
      }, opts.theme ?? "dark");
      const page = await ctx.newPage();
      // "Failed to load resource" console lines carry no URL; the response listener below reports those with one.
      page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text().slice(0, 240)}`));
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 240)}`));
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.host !== new URL(BASE).host) return;
        if (r.status() >= 500 || (r.status() >= 400 && !EXPECTED_4XX.test(u.pathname))) problems.push(`http ${r.status()}: ${r.request().method()} ${u.pathname}`);
      });
      return page;
    });
    for (const c of contexts) await c.close();
  },
  api: async ({}, use) => {
    const made: APIRequestContext[] = [];
    await use(async (role) => {
      const ctx = await request.newContext({ baseURL: BASE, storageState: role ? `e2e/.auth/${role}.json` : undefined });
      made.push(ctx);
      return ctx;
    });
    for (const c of made) await c.dispose();
  },
});

/** Fail the test when the page logged errors; call at the end of browser tests. */
export function noProblems(problems: string[]) {
  expect(problems, problems.join("\n")).toEqual([]);
}

/** Open an event page and wait for it to settle. */
export async function openEvent(page: Page, id: string) {
  await page.goto(`/e/${encodeURIComponent(id)}`);
  await page.locator(".event-title").waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Open a section of the event page (Details, Comments, Wall, Here now, Friends) if it's closed. */
export async function openSection(page: Page, id: "details" | "comments" | "wall" | "here" | "people") {
  const row = page.locator(`#ev-${id}`);
  await row.scrollIntoViewIfNeeded();
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

export { expect };
