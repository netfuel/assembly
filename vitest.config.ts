import { defineConfig } from "vitest/config";

// Plain config so the Cloudflare and PWA plugins don't start during unit tests.
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "worker/**/*.test.ts", "tests/**/*.test.ts"] },
});
