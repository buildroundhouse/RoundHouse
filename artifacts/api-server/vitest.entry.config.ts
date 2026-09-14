import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      vitest: fileURLToPath(
        new URL("./node_modules/vitest/dist/index.js", import.meta.url),
      ),
      "@": fileURLToPath(new URL("../round-house", import.meta.url)),
    },
  },
  test: {
    include: ["../round-house/lib/entry-navigation.test.ts"],
    environment: "node",
  },
});
