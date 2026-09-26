import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    },
    // src/ is included so a colocated test can never sit unrun again
    // (src/observability/__tests__ went unexecuted with 12 failures).
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
