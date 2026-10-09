import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the service layer (telemetry, ML engine, ledger, reports). Kept separate from
// vite.config.ts so tests don't boot the TanStack Start / Nitro build plugins.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Unit coverage targets the framework-free core (services + API); React views are covered
    // by the Playwright E2E suite.
    coverage: {
      provider: "v8",
      include: ["src/services/**/*.ts", "src/api/**/*.ts", "src/i18n/translate.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
