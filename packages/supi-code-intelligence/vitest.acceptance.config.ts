import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["__tests__/acceptance/**/*.acceptance.ts"],
    pool: "threads",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
