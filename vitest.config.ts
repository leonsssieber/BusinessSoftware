import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// node:sqlite still prints an ExperimentalWarning on Node 22; test workers inherit this.
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" ");

export default defineConfig({
  resolve: {
    alias: {
      "@core": r("./src/core"),
      "@ui": r("./src/ui"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    pool: "forks",
    testTimeout: 20000,
  },
});
