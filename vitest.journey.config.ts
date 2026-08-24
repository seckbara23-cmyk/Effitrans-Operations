import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * C-4 — the production-faithful journey harness.
 * ---------------------------------------------------------------------------
 * A SEPARATE vitest project from the unit suite because it needs a real
 * PostgreSQL (the CI `rls-tests` job's local Supabase) and must never be run by
 * accident in an environment without one — a journey suite that silently skips
 * is worse than no journey suite.
 *
 * THREE aliases, and only three:
 *   • `server-only`      — the existing unit-suite stub (Node has no bundler
 *                          boundary to protect);
 *   • `next/cache`       — presentation plumbing that throws outside a request
 *                          context; calls are recorded, not swallowed;
 *   • `lib/auth/current-user` — THE stubbed boundary: who is signed in.
 *
 * Everything else — permissions, tenancy, the engine, gates, evidence, audit,
 * Finance, custody, closure — executes for real against the real database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/journey/**/*.journey.ts"],
    // Serial: the journey is a single narrative over shared fixtures, and
    // parallel workers would race each other's dossiers.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "next/cache": fileURLToPath(new URL("./tests/stubs/next-cache.ts", import.meta.url)),
      "@/lib/auth/current-user": fileURLToPath(new URL("./tests/stubs/current-user.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
