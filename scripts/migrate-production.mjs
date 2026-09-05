/**
 * Production migration runner — apply and record as one indivisible operation.
 * ---------------------------------------------------------------------------
 * THE POINT. Applying SQL and recording it in the ledger are two commands. In
 * September 2026 the first ran sixteen times and the second never did, and
 * because nothing bound them together the result looked like success. This
 * runner makes "applied but unrecorded" a NAMED FAILURE STATE rather than a
 * silent outcome, and refuses to run again while one is outstanding.
 *
 * SIX STEPS, IN ORDER, EACH ABLE TO STOP THE WORLD:
 *   0  preflight   — clean tree, committed file, companion verifier present
 *   1  validate    — repository/ledger integrity + the ordering invariant
 *   2  apply       — exactly ONE migration's SQL
 *   3  verify      — the companion verifier must return ok = true
 *   4  record      — `supabase migration repair --status applied <version>`
 *   5  post-verify — ledger moved, nothing pending, verifier STILL passes
 *
 * WHAT IT WILL NOT DO. It never writes `supabase_migrations` with SQL — step 4
 * is the supported mechanism and nothing else. It never applies more than one
 * migration. It has no flag that skips approval: break-glass changes WHO may
 * approve the environment, never WHICH steps run. And it never attempts an
 * improvised rollback, because a half-applied DDL cannot be undone by guessing.
 *
 * EXIT  0 success · 10 NOT_APPLIED · 20 VERIFY_FAILED
 *       30 SCHEMA_AHEAD_OF_LEDGER · 40 POST_RECORD_MISMATCH · 2 preflight/usage
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { target, applyFile, queryFile, repair, query } from "./migration/exec.mjs";
import { repoMigrations, remoteLedger, reconcile, validateTarget, crossCheckCli } from "./migration/ledger.mjs";

const STATE = {
  OK: { code: 0, name: "APPLIED_AND_RECORDED" },
  PREFLIGHT: { code: 2, name: "PREFLIGHT_REFUSED" },
  NOT_APPLIED: { code: 10, name: "NOT_APPLIED" },
  VERIFY_FAILED: { code: 20, name: "VERIFY_FAILED" },
  SCHEMA_AHEAD: { code: 30, name: "SCHEMA_AHEAD_OF_LEDGER" },
  POST_MISMATCH: { code: 40, name: "POST_RECORD_MISMATCH" },
};

function parseArgs(argv) {
  const a = { dryRun: false, requireCleanTree: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--linked") a.target = { kind: "linked" };
    else if (v === "--local") a.target = { kind: "local" };
    else if (v === "--db-url") a.target = { kind: "db-url", url: argv[++i] };
    else if (v === "--project-ref") a.target = { kind: "project-ref", ref: argv[++i] };
    else if (v === "--version") a.version = argv[++i];
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--allow-dirty-tree") a.requireCleanTree = false;
  }
  return a;
}

const log = (s = "") => console.log(s);
function stop(state, lines) {
  log("");
  console.error(`[migrate] ✗ ${state.name}`);
  for (const l of lines) console.error(`[migrate]   ${l}`);
  console.error("");
  console.error(`[migrate] Migrations are HELD. The integrity guard will fail until this is resolved,`);
  console.error(`[migrate] which blocks every subsequent deployment by design. Resolve deliberately;`);
  console.error(`[migrate] do not improvise a rollback.`);
  process.exit(state.code);
}

function gitClean() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "";
  } catch {
    return null;
  }
}
function gitTracked(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target || !args.version) {
    console.error("[migrate] usage: node scripts/migrate-production.mjs --linked --version <14-digit> [--dry-run]");
    process.exit(STATE.PREFLIGHT.code);
  }
  const tgt = target(args.target);
  const version = args.version;

  log(`[migrate] ============================================================`);
  log(`[migrate] target   : ${tgt.label}`);
  log(`[migrate] version  : ${version}`);
  log(`[migrate] mode     : ${args.dryRun ? "DRY RUN (no apply, no record)" : "APPLY"}`);
  log(`[migrate] ============================================================`);

  // ---- step 0: preflight --------------------------------------------------
  log("[migrate] step 0 — preflight");
  const repo = repoMigrations();
  const m = repo.find((x) => x.version === version);
  if (!m) stop(STATE.PREFLIGHT, [`no committed migration file for version ${version}`]);
  if (args.requireCleanTree) {
    const clean = gitClean();
    if (clean === false) stop(STATE.PREFLIGHT, ["the working tree has uncommitted changes"]);
    if (clean === null) log("[migrate]   (git unavailable — tree cleanliness unverified)");
  }
  if (!gitTracked(m.path)) stop(STATE.PREFLIGHT, [`${m.path} is not committed`]);
  if (!existsSync(m.verifier)) stop(STATE.PREFLIGHT, [`missing companion verifier ${m.verifier}`]);
  if (!gitTracked(m.verifier)) stop(STATE.PREFLIGHT, [`${m.verifier} is not committed`]);

  const declared = /--\s*migrate:executor\s+([a-z-]+)/i.exec(readFileSync(m.path, "utf8"));
  const executor = declared ? declared[1].toLowerCase() : "db-query";
  if (executor !== "db-query") {
    stop(STATE.PREFLIGHT, [
      `${m.file} declares executor "${executor}", which this runner does not apply automatically.`,
      `Concurrent DDL and long operations must be run by an operator per the runbook,`,
      `then recorded through this runner's --version step once verified.`,
    ]);
  }
  log(`[migrate]   file ${m.file} · verifier present · executor ${executor} · tree clean`);

  // ---- step 1: validate ---------------------------------------------------
  log("[migrate] step 1 — validate repository/ledger state");
  const ledger = remoteLedger(tgt);
  const state = reconcile(repo, ledger);
  log(`[migrate]   repo=${state.repoCount} ledger=${state.ledgerCount} max=${state.remoteMax || "(empty)"} pending=[${state.pending.join(", ")}]`);
  const problems = validateTarget(version, repo, ledger, state);
  const cross = crossCheckCli(tgt, state.pending);
  if (cross.checked && !cross.agrees) problems.push(`supabase migration list disagrees: ${cross.detail}`);
  if (problems.length) stop(STATE.PREFLIGHT, problems);
  for (const a of state.advisory) log(`[migrate]   advisory: ${a.code} ${a.version} — ${a.detail}`);
  log("[migrate]   invariants hold — exactly this migration is pending");

  // A verifier that already passes means the SQL is applied but unrecorded:
  // the incident state, reached BEFORE we touch anything.
  let pre = null;
  try {
    const rows = queryFile(tgt, m.verifier);
    pre = rows.length === 1 ? rows[0] : null;
  } catch {
    pre = null; // expected: objects absent
  }
  if (pre && pre.ok === true) {
    stop(STATE.SCHEMA_AHEAD, [
      `${version} is not in the ledger, but its verifier already passes.`,
      `The SQL is applied and unrecorded. Do NOT re-apply it.`,
      `Record it: supabase migration repair --linked --status applied ${version}`,
    ]);
  }

  if (args.dryRun) {
    log("");
    log("[migrate] DRY RUN complete — every precondition passed.");
    log(`[migrate] A real run would: apply ${m.file}, verify, record ${version}, re-verify.`);
    process.exit(0);
  }

  // ---- step 2: apply ------------------------------------------------------
  log("[migrate] step 2 — apply SQL");
  const applied = applyFile(tgt, m.path);
  if (!applied.ok) {
    stop(STATE.NOT_APPLIED, [
      `the migration SQL was rejected; the ledger was NOT written.`,
      `Production should be unchanged (the body runs as one implicit transaction),`,
      `but that is an expectation, not a guarantee — confirm with the verifier before retrying.`,
      `database said: ${String(applied.message).replace(/\s+/g, " ").slice(0, 500)}`,
    ]);
  }
  log("[migrate]   applied");

  // ---- step 3: verify -----------------------------------------------------
  log("[migrate] step 3 — verify postconditions");
  let verdict = null;
  try {
    const rows = queryFile(tgt, m.verifier);
    verdict = rows.length === 1 ? rows[0] : null;
  } catch (e) {
    stop(STATE.VERIFY_FAILED, [
      `the verifier could not run after a SUCCESSFUL apply — production state is indeterminate.`,
      `The ledger was NOT written. Diagnose before any further action.`,
      `error: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`,
    ]);
  }
  if (!verdict || verdict.ok !== true) {
    stop(STATE.VERIFY_FAILED, [
      `the SQL applied but its postconditions do NOT hold.`,
      `The ledger was NOT written. Production may be partially changed; there is no safe`,
      `automatic rollback for DDL, so this needs a human.`,
      `detail: ${verdict ? verdict.detail : "verifier returned no row"}`,
    ]);
  }
  log(`[migrate]   verified — ${verdict.detail}`);

  // ---- step 4: record (the supported mechanism, nothing else) -------------
  log("[migrate] step 4 — record in the ledger");
  const rec = repair(tgt, version);
  if (!rec.ok) {
    stop(STATE.SCHEMA_AHEAD, [
      `the migration APPLIED and VERIFIED, but recording it failed.`,
      `Production schema is now AHEAD OF THE LEDGER — the exact condition this`,
      `toolchain exists to prevent. Do NOT re-apply the SQL.`,
      `Once the cause is fixed, record it alone:`,
      `  supabase migration repair --linked --status applied ${version}`,
      `repair said: ${String(rec.message).replace(/\s+/g, " ").slice(0, 400)}`,
    ]);
  }
  log("[migrate]   recorded");

  // ---- step 5: post-record verification -----------------------------------
  log("[migrate] step 5 — post-record verification");
  const after = reconcile(repo, remoteLedger(tgt));
  const post = [];
  if (after.remoteMax !== version) post.push(`ledger maximum is ${after.remoteMax}, expected ${version}`);
  if (after.pending.length !== 0) post.push(`${after.pending.length} migration(s) still pending: ${after.pending.join(", ")}`);
  if (after.hard.length) post.push(`integrity findings after recording: ${after.hard.map((h) => h.code).join(", ")}`);
  try {
    const rows = queryFile(tgt, m.verifier);
    if (!(rows.length === 1 && rows[0].ok === true)) post.push("the verifier no longer passes after recording");
  } catch (e) {
    post.push(`the verifier could not be re-run: ${String(e.message).slice(0, 200)}`);
  }
  if (post.length) {
    stop(STATE.POST_MISMATCH, [
      ...post,
      `The ledger HAS been written. Do not improvise a correction; report and preserve state.`,
    ]);
  }

  log("");
  log(`[migrate] ✓ ${STATE.OK.name} — ${version} applied, verified, recorded, re-verified.`);
  log(`[migrate]   ledger now ${after.ledgerCount} rows, max ${after.remoteMax}, 0 pending.`);
  process.exit(0);
}

main();
