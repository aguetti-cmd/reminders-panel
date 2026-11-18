import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Fixed time zone so day grouping tests are stable.
    env: { TZ: "Asia/Bangkok" },
    testTimeout: 20000,
  },
});
