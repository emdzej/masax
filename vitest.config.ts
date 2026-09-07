import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    // The dataset suites walk a real installation, so the default 5 s is not
    // enough to preload a 5 MB index or decode 18,760 drawings.
    testTimeout: process.env.MASAX_DATA ? 120_000 : 5_000,
    hookTimeout: 60_000,
  },
});
