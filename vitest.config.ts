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
        "src/discovery.ts",
        "src/fs-safety.ts",
        "src/generate.ts",
        "src/hook-output.ts",
        "src/hook-root.ts",
        "src/hooks.ts",
        "src/install.ts",
        "src/inventory.ts",
        "src/lock.ts",
        "src/maintenance.ts",
        "src/paths.ts",
        "src/policy.ts",
        "src/runtime.ts",
        "src/state.ts",
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
