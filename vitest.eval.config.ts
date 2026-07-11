import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Dedicated config for the LOCAL, LIVE model-evaluation runner. Kept separate from
// vitest.config.ts (include: tests/**/*.test.ts) so `npm test` never triggers a
// real Ollama run. Invoked only via `npm run ai:eval:local` (EVAL_MODEL=<model>).
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/eval/**/*.ts"],
    fileParallelism: false,
    testTimeout: 3_000_000, // up to 50 min for a full slow-CPU model run
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
