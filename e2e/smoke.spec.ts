import { test, expect, noProblems, openEvent } from "./helpers";
import { EV } from "./roles";

test("setup: fixtures and roles work", async ({ as, api, problems }) => {
  const a = await api("fanA");
  expect((await (await a.get("/api/me")).json()).user.displayName).toBe("E2E Fan A");
  const page = await as("fanA");
  await openEvent(page, EV.live);
  await expect(page.locator(".event-title")).toHaveText("E2E Live Night");
  noProblems(problems);
});
