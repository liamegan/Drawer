import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { exportPlugin } from "./tools/export-plugin.ts";

export default defineConfig({
  // Lets the playground's batch export write into exports/ (dev only).
  plugins: [exportPlugin()],
  resolve: {
    // Lets playground sketches import the library exactly as a consumer would.
    alias: {
      "wtc-drawer": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "index.es.js",
    },
    rolldownOptions: {
      external: ["wtc-math"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
