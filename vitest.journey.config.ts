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
 * FOUR aliases, and only four:
 *   • `server-only`      — the existing unit-suite stub (Node has no bundler
 *                          boundary to protect);
 *   • `next/cache`       — presentation plumbing that throws outside a request
 *                          context; calls are recorded, not swallowed;
 *   • `lib/auth/current-user` — THE stubbed boundary: who is signed in;
 *   • `react`            — `cache()` passthrough (request-scoped memoisation is
 *                          not callable outside a render; removing it makes the
 *                          journey stricter, never laxer).
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
    // ARRAY form with regexes, not an object of prefixes. The object form only
    // matched the `@/...` specifier, but `require-permission.ts` imports
    // `./current-user` RELATIVELY — so the session stub never applied, the real
    // getCurrentUser found no cookies, and EVERY action returned "forbidden".
    // That read like an authority failure and was a resolution failure.
    alias: [
      { find: "server-only", replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
      { find: "next/cache", replacement: fileURLToPath(new URL("./tests/stubs/next-cache.ts", import.meta.url)) },
      { find: /^react$/, replacement: fileURLToPath(new URL("./tests/stubs/react.ts", import.meta.url)) },
      // Match the module however it is imported: "@/lib/auth/current-user",
      // "./current-user" from within lib/auth, or any deeper relative form.
      { find: /(^@\/lib\/auth\/current-user$)|(^\.\/current-user$)|(\/lib\/auth\/current-user$)/,
        replacement: fileURLToPath(new URL("./tests/stubs/current-user.ts", import.meta.url)) },
      { find: /(^@\/lib\/supabase\/server$)|(\/lib\/supabase\/server$)/,
        replacement: fileURLToPath(new URL("./tests/stubs/supabase-server.ts", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
});
