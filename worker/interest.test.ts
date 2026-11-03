import { describe, expect, it } from "vitest";
import { cleanSource, deviceFamily, emailHash } from "./interest";

describe("interest list helpers", () => {
  it("hashes the normalised address so the same person is one row", async () => {
    const a = await emailHash("matt@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await emailHash("matt@example.com")).toBe(a);
    expect(await emailHash("other@example.com")).not.toBe(a);
  });
  it("keeps the device family coarse", () => {
    expect(deviceFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(deviceFamily("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(deviceFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("desktop");
    expect(deviceFamily(undefined)).toBeNull();
  });
  it("accepts only a short plain source label", () => {
    expect(cleanSource("gate")).toBe("gate");
    expect(cleanSource(" Instagram-Bio ")).toBe("instagram-bio");
    expect(cleanSource("<script>")).toBe("script");
    expect(cleanSource("")).toBeNull();
    expect(cleanSource(42)).toBeNull();
    expect(cleanSource("x".repeat(100))).toHaveLength(40);
  });
});
