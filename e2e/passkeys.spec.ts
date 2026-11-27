// Passkeys (worker/passkeys.ts, src/lib/passkeys.ts), through Chrome's virtual authenticator: a real
// WebAuthn ceremony against the local server, with the authenticator standing in for Face ID.
import type { Page } from "@playwright/test";
import { test, expect, noProblems } from "./helpers";

async function faceId(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const toast = (page: Page) => page.locator(".toast");

test.describe("Passkeys", () => {
  test("add one from Profile, sign out, sign back in with it", async ({ as, problems }) => {
    const page = await as("fanC");
    await faceId(page);
    await page.goto("/");
    const me = (await (await page.request.get("/api/me")).json()).user.id as string;

    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Profile" }).click();
    await page.getByRole("button", { name: /^Passkeys/ }).click();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(toast(page)).toContainText("Passkey added");
    await expect(page.getByRole("button", { name: "Passkeys · 1" })).toBeVisible();
    const list = (await (await page.request.get("/api/me/passkeys")).json()).passkeys;
    expect(list).toHaveLength(1);

    // Signed out: no cookie at all. The passkey alone gets back in.
    await page.context().clearCookies();
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page.locator("button.avatar")).toBeVisible({ timeout: 15000 });
    expect((await (await page.request.get("/api/me")).json()).user.id).toBe(me);
    expect((await (await page.request.get("/api/me/passkeys")).json()).passkeys[0].lastUsedAt).toBeTruthy();

    // Remove it again so the next run starts clean.
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Profile" }).click();
    await page.getByRole("button", { name: /^Passkeys/ }).click();
    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(toast(page)).toContainText("Passkey removed");
    expect((await (await page.request.get("/api/me/passkeys")).json()).passkeys).toHaveLength(0);
    noProblems(problems);
  });

  test("the API refuses stale, malformed and signed-out requests", async ({ api }) => {
    const anon = await api(null);
    expect((await anon.post("/api/auth/passkey/verify", { data: {} })).status()).toBe(400);
    expect((await anon.post("/api/auth/passkey/verify", { data: { flow: "x".repeat(24), response: { id: "abc" } } })).status()).toBe(400);
    expect((await anon.get("/api/me/passkeys")).status()).toBe(401);
    expect((await anon.post("/api/me/passkeys/options")).status()).toBe(401);
    const { options, flow } = await (await anon.post("/api/auth/passkey/options")).json();
    expect(options.rpId).toBe("localhost");
    expect(flow).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  test("the iOS app is tied to the domain", async ({ api }) => {
    const anon = await api(null);
    const res = await anon.get("/.well-known/apple-app-site-association", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect((await res.json()).webcredentials.apps).toEqual(["8F569K6WBX.rsvp.assembly.app"]);
  });
});
