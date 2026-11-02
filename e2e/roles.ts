export const BASE = "http://localhost:5174";

/** Dev sign-in names. Test Moderator matches MODERATORS=test-moderator@dev.localhost in .dev.vars. */
export const ROLES = {
  fanA: "E2E Fan A",
  fanB: "E2E Fan B",
  fanC: "E2E Fan C",
  host: "E2E Host",
  owner: "E2E Page Owner",
  mod: "Test Moderator",
  throwaway: "E2E Throwaway",
} as const;
export type Role = keyof typeof ROLES;

/** The e2e fixture events made in global-setup. */
export const EV = { live: "e2e-live", upcoming: "e2e-upcoming", past: "e2e-past", cancelled: "e2e-cancelled", photoFree: "sample-wet-paint" } as const;
/** Pulp Warehouse, where the e2e events are. */
export const VENUE = { lat: 35.1523, lng: -90.0128 };
