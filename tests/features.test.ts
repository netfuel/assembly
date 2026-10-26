import { describe, expect, it } from "vitest";
import { features, moduleFor } from "../worker/features";

describe("feature flags", () => {
  it("are all on unless listed", () => {
    expect(features({})).toEqual({ wall: true, friends: true, checkin: true, reactions: true });
    expect(features({ FEATURES_OFF: " Wall, checkin " })).toEqual({ wall: false, friends: true, checkin: false, reactions: true });
    expect(features({ FEATURES_OFF: "reactions" }).reactions).toBe(false);
  });
  it("map routes to modules", () => {
    expect(moduleFor("/events/abc/wall")).toBe("wall");
    expect(moduleFor("/wall/media/x/thumb")).toBe("wall");
    expect(moduleFor("/mod/wall/1")).toBe("wall");
    expect(moduleFor("/friends/at")).toBe("friends");
    expect(moduleFor("/events/abc/invite")).toBe("friends");
    expect(moduleFor("/events/abc/here")).toBe("friends");
    expect(moduleFor("/events/abc/friend-visibility")).toBe("friends");
    expect(moduleFor("/events/abc/checkin")).toBe("checkin");
    expect(moduleFor("/events/abc/presence")).toBe("checkin");
    expect(moduleFor("/events/abc/react")).toBe("reactions");
    expect(moduleFor("/events/abc")).toBeNull();
    expect(moduleFor("/events")).toBeNull();
  });
});
