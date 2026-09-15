import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../round-house/", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      // Pick up pure-helper tests colocated with their source in
      // sibling artifacts (see artifacts/round-house/lib/*.test.ts).
      // Round-house has no runner of its own; api-server's vitest is
      // the single test runner for the monorepo.
      "../round-house/lib/**/*.test.ts",
    ],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
