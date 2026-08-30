import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // Production code still imports `server-only`; tests replace the package
      // with a no-op so Node can load server modules without Next's build guard.
      "server-only": fileURLToPath(new URL("./tests/shims/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "cli/**/*.test.ts",
      "workers/**/*.test.ts",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
