import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // CUSTOMS-REF-RBAC-REGRESSION-01 — JSX for the TEST transform only.
  //
  // tsconfig says `"jsx": "preserve"` because Next.js compiles JSX itself with
  // the automatic runtime. Vitest does not go through that pipeline, so esbuild
  // fell back to the CLASSIC transform and every component render failed with
  // "React is not defined". Naming the automatic runtime here matches what the
  // application is actually built with, and affects nothing but tests: the Next
  // build never reads this file.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
