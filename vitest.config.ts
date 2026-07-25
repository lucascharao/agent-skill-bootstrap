import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/config.ts",
        "src/detection.ts",
        "src/install.ts",
        "src/inventory.ts",
        "src/policy.ts",
        "src/sync.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 85,
        statements: 80,
        branches: 55,
      },
    },
  },
});
