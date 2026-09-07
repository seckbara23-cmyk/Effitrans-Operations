/**
 * Run every companion verifier against a database that HAS the migrations.
 * READ-ONLY, ALWAYS.
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES, and it is the whole reason this script exists.
 *
 * A verifier is only ever executed in two places, and until now BOTH ran it
 * against a database that LACKED its migration:
 *
 *   * the integrity guard runs it for each PENDING migration — by definition
 *     one that has not been applied — where erroring is the expected answer and
 *     is logged as "consistent with not applied";
 *   * the runner runs it at step 3, immediately after applying — which is the
 *     first time it meets a database that has the objects, and by then the SQL
 *     is already in production.
 *
 * CI never ran them at all: `supabase db reset` applies every migration, so
 * nothing is pending, so the guard runs no verifier.
 *
 * The consequence was found on 2026-09-07. The #140 and #141 verifiers each
 * compared a row timestamp against `supabase_migrations.schema_migrations.
 * inserted_at`, a column that does not exist. A verifier is ONE statement, so
 * Postgres planned the whole file and rejected it with 42703 — every check in
 * the file, including the ones that would have passed. Nothing noticed, because
 * a verifier erroring against a database without its migration is the normal
 * case. The first time anyone would have learned was the runner's step 3, on
 * production, after the DDL had landed — the `VERIFY_FAILED` state the policy
 * calls "production is indeterminate, no automatic rollback, diagnose by hand".
 *
 * So: after CI applies all migrations, run every verifier and require ok=true.
 * The cost is one query per verifier; the thing it buys is that a broken safety
 * net is found on a disposable database instead of a live one.
 *
 * It imports `queryFile` only. `applyFile` and `repair` are deliberately absent,
 * so there is no code path here that can change anything, and a test asserts it.
 *
 * EXIT 0 every verifier passed · 1 one or more failed · 2 could not run.
 *
 * Usage:
 *   node scripts/verify-migrations.mjs --db-url "$DATABASE_URL"
 *   node scripts/verify-migrations.mjs --linked          (read-only; safe)
 */
import { existsSync } from "node:fs";
import { target, queryFile } from "./migration/exec.mjs";
import { repoMigrations, remoteLedger } from "./migration/ledger.mjs";

function parseArgs(argv) {
  const a = { dir: "supabase/migrations" };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--linked") a.target = { kind: "linked" };
    else if (v === "--local") a.target = { kind: "local" };
    else if (v === "--db-url") a.target = { kind: "db-url", url: argv[++i] };
    else if (v === "--project-ref") a.target = { kind: "project-ref", ref: argv[++i] };
    else if (v === "--dir") a.dir = argv[++i];
    // Only these versions, comma-separated. Used by the promotion rehearsal to
    // check one verifier at the moment its migration lands.
    else if (v === "--only") a.only = new Set(argv[++i].split(",").map((x) => x.trim()));
    // Check every verifier, including those whose migration is NOT applied.
    // They will fail, and correctly so — use it only to see the whole set.
    else if (v === "--include-pending") a.includePending = true;
  }
  return a;
}

const log = (s = "") => console.log(s);
const short = (s) => String(s).replace(/\s+/g, " ").slice(0, 300);

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error("[verify] a target is required: --linked | --local | --db-url <url> | --project-ref <ref>");
    process.exit(2);
  }

  let tgt, repo, applied;
  try {
    tgt = target(args.target);
    repo = repoMigrations(args.dir).filter((m) => existsSync(m.verifier));
    applied = new Set(remoteLedger(tgt).map((r) => r.version));
  } catch (e) {
    console.error(`[verify] could not start: ${e.message}`);
    process.exit(2);
  }
  if (args.only) repo = repo.filter((m) => args.only.has(m.version));

  // ---- ONLY APPLIED MIGRATIONS, AND THAT IS THE WHOLE POINT ---------------
  //
  // The question this script answers is "does every verifier still pass against
  // the schema its migration produced". For a migration that has NOT been
  // applied, the verifier erroring is the CORRECT answer — the objects are
  // genuinely absent — and reporting it as a failure would make the tool useless
  // against production, where a pending backlog is normal.
  //
  // In CI this filter removes nothing: `db reset` applies every migration, so
  // every verifier is checked. Against production it checks exactly the ones
  // whose postconditions are supposed to hold right now.
  const skipped = args.includePending ? [] : repo.filter((m) => !applied.has(m.version));
  if (!args.includePending) repo = repo.filter((m) => applied.has(m.version));

  log(`[verify] target    : ${tgt.label}`);
  log(`[verify] applied   : ${applied.size} migrations in the ledger`);
  log(`[verify] checking  : ${repo.length} verifier(s)`);
  if (skipped.length) {
    log(`[verify] skipping  : ${skipped.length} not applied (${skipped.map((m) => m.version).join(", ")})`);
  }
  log("");

  const failed = [];
  for (const m of repo) {
    let rows;
    try {
      rows = queryFile(tgt, m.verifier);
    } catch (e) {
      // Against a database that HAS the migration this is a broken verifier,
      // not a missing object — which is exactly the defect this script exists
      // to catch, so it is a failure and never a shrug.
      failed.push(`${m.version} — the verifier could not run: ${short(e.message)}`);
      log(`  ✗ ${m.version} COULD NOT RUN`);
      continue;
    }
    if (rows.length !== 1) {
      failed.push(`${m.version} — returned ${rows.length} rows; the contract is exactly one`);
      log(`  ✗ ${m.version} returned ${rows.length} rows`);
      continue;
    }
    const { ok, detail } = rows[0];
    // The contract is (ok boolean, detail text). A verifier that returns a
    // truthy non-boolean has not met it.
    if (ok !== true) {
      failed.push(`${m.version} — ok=${JSON.stringify(ok)} · ${short(detail)}`);
      log(`  ✗ ${m.version} FAILED — ${short(detail)}`);
      continue;
    }
    log(`  ✓ ${m.version} — ${short(detail)}`);
  }

  log("");
  if (failed.length) {
    console.error(`[verify] FAILED — ${failed.length}/${repo.length} verifier(s) did not pass:`);
    for (const f of failed) console.error(`  ✗ ${f}`);
    console.error("");
    console.error("[verify] A verifier is the runner's only evidence that a migration did what it");
    console.error("[verify] claimed. A broken one is not a cosmetic problem: it turns a successful");
    console.error("[verify] apply into VERIFY_FAILED, which the policy calls indeterminate.");
    process.exit(1);
  }
  if (repo.length === 0) {
    log(`[verify] OK — nothing to check: no applied migration has a companion verifier.`);
    process.exit(0);
  }
  log(
    `[verify] OK — ${repo.length}/${repo.length} verifier(s) pass against ${tgt.label}` +
      (skipped.length ? `; ${skipped.length} not applied and therefore not checked.` : "."),
  );
  process.exit(0);
}

main();
