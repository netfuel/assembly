// Fresh database for the regression suite: wipes .wrangler/e2e, applies every migration, loads the seed.
// The suite's server (port 5174, E2E=1) uses this state, so your own local data is never touched.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const run = (args) => execFileSync("npx", ["wrangler", "d1", ...args, "assembly", "--local", "--persist-to", ".wrangler/e2e"], { stdio: "inherit" });
rmSync(".wrangler/e2e", { recursive: true, force: true });
run(["migrations", "apply"]);
// Demo mode loads the demo site's content instead of the local sample data.
run(["execute", `--file=./db/${process.env.E2E_DEMO ? "demo/seed.sql" : "seed.sql"}`]);
