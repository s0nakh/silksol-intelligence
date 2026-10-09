import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the service layer (telemetry, ML engine, ledger, reports). Kept separate from
// vite.config.ts so tests don't boot the TanStack Start / Nitro build plugins.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
