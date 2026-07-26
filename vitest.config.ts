import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/briefing.ts",
        "src/config.ts",
        "src/detection.ts",
        "src/generate.ts",
        "src/hook-output.ts",
        "src/install.ts",
        "src/inventory.ts",
        "src/lock.ts",
        "src/maintenance.ts",
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
