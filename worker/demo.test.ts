import { describe, expect, it } from "vitest";
import { DEMO_SEED_SQL as seed } from "./demoSeed";
import { demoOn, seedStatements } from "./demo";

describe("demo mode", () => {
  it("is on only when DEMO is 1", () => {
    expect(demoOn({})).toBe(false);
    expect(demoOn({ DEMO: "0" })).toBe(false);
    expect(demoOn({ DEMO: "1" })).toBe(true);
  });

  it("splits the seed into whole statements, keeping semicolons inside text", () => {
    const sql = "-- note\nDELETE FROM a;\nINSERT INTO b VALUES ('x; y',\n 1);\n";
    expect(seedStatements(sql)).toEqual(["DELETE FROM a", "INSERT INTO b VALUES ('x; y',\n 1)"]);
  });

  it("seeds only invented content, none of it marked sample", () => {
    const statements = seedStatements(seed);
    expect(statements.length).toBeGreaterThan(50);
    expect(seed).not.toMatch(/'live', 1\n/);
    for (const s of statements.filter((s) => s.startsWith("INSERT INTO events"))) expect(s).toMatch(/'demo-/);
  });
});
