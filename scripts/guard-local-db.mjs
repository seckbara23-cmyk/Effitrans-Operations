/**
 * Local-database guard for destructive/fixture-writing test suites (Phase 8.0C — finding AC-1).
 * ---------------------------------------------------------------------------
 * The RLS test suite INSERTS fixture tenants/users (raw auth.users skeletons, @test.local
 * emails, fixture tenant B) — it is designed for the DISPOSABLE local/CI database only.
 * Production acceptance found fixture rows in the production database (runtime evidence:
 * the archive of `commsmgr@test.local` — an rls_communication_test.sql fixture), proving the
 * suite was once pointed at production. This guard makes that mistake impossible:
 * `npm run test:rls` refuses any DATABASE_URL that is not a local address.
 *
 * Usage: node scripts/guard-local-db.mjs && psql "$DATABASE_URL" -f <suite>
 */
const url = process.env.DATABASE_URL ?? "";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

let host = "";
try {
  // postgres URLs parse with the URL class when the scheme is normalized.
  host = new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).hostname;
} catch {
  host = "";
}

if (!url) {
  console.error("[guard-local-db] DATABASE_URL is not set — start local Supabase first (npm run db:start).");
  process.exit(1);
}
if (!LOCAL_HOSTS.has(host)) {
  console.error(`[guard-local-db] REFUSED: DATABASE_URL points at "${host}" — the RLS fixture suite`);
  console.error("[guard-local-db] writes test tenants/users and must NEVER run against a remote database.");
  console.error("[guard-local-db] Point DATABASE_URL at the local Supabase stack (npm run db:start).");
  process.exit(1);
}
console.log(`[guard-local-db] OK — local database (${host}).`);
