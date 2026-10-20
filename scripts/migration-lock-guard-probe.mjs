/**
 * Prove the APPLY GUARD's semantics against a real database.
 * ---------------------------------------------------------------------------
 * WHAT IS BEING PROVED, AND WHY IT NEEDS A DATABASE. `APPLY_GUARD` in
 * migrate-production.mjs prepends two `set local` statements to a migration
 * body so a DDL lock wait fails in 3 s instead of queueing every reader of the
 * table behind an ACCESS EXCLUSIVE request for the 120 s `statement_timeout`.
 * Three claims hold that up, and not one of them can be checked by reading
 * source:
 *
 *   1. `set local lock_timeout` in the first statement governs the DDL later
 *      in the same body;
 *   2. when it fires, the FULL body rolls back — including a `drop constraint`
 *      that had already succeeded — so there is no half-applied schema;
 *   3. nothing is written to the migration ledger when an apply fails.
 *
 * WHY psql AND NOT THE SUPABASE CLI. Scenario C needs two sessions at once:
 * one holding a conflicting lock, one attempting the DDL. `supabase db query`
 * is one-shot per invocation, and over `--db-url` it drives the extended query
 * protocol, which rejects a multi-statement body outright ("cannot insert
 * multiple commands into a prepared statement") — so the guard cannot even be
 * sent down the transport CI has. psql can hold a session open and can take a
 * whole file, so it is the only instrument here that can ask the question.
 *
 * FIDELITY. Production's transport (`--linked`, a direct pooler connection)
 * wraps a whole file in ONE implicit transaction; that was measured separately,
 * read-only, against production — a `set local` in the file's first statement
 * was still in effect for its last, and a fresh connection afterwards was back
 * to the defaults. psql autocommits each statement by default, so
 * `--single-transaction` is used below to reproduce that same one-transaction
 * shape. The guard's SQL text here is the production constant, imported, not a
 * copy — a probe that tested its own transcription would prove nothing.
 *
 * SAFETY. Everything happens inside a scratch schema this script creates and
 * drops. It never touches a real table, never writes the ledger, and refuses a
 * target whose host is not local.
 *
 * Usage:
 *   node scripts/migration-lock-guard-probe.mjs --db-url postgresql://...@127.0.0.1:54322/postgres
 *
 * EXIT 0 every scenario behaved as designed · 1 one or more did not · 2 could
 * not run.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// From exec.mjs, NOT from migrate-production.mjs: that file calls `main()` at
// module scope, so importing it to borrow a constant would launch the
// production migration runner.
import { APPLY_GUARD } from "./migration/exec.mjs";

const SCHEMA = "eft_lockguard_probe";
const LOCK_TIMEOUT = "3s";

// ---------------------------------------------------------------- arguments
let dbUrl = "";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--db-url") dbUrl = argv[++i] ?? "";
}
if (!dbUrl) {
  console.error("[lockguard] usage: node scripts/migration-lock-guard-probe.mjs --db-url <url>");
  process.exit(2);
}
// This script deliberately provokes failing SQL and takes exclusive locks.
// It runs against a disposable database or not at all.
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(dbUrl)) {
  console.error(`[lockguard] refused: ${dbUrl.replace(/:[^:@/]*@/, ":***@")} is not a local target.`);
  console.error("[lockguard] this probe provokes errors and takes ACCESS EXCLUSIVE locks.");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "eft-lockguard-"));
const sqlFile = (name, sql) => {
  const f = join(dir, name);
  writeFileSync(f, sql, "utf8");
  return f;
};

/** Run a file in ONE transaction, the shape production's transport gives it. */
function psqlFile(file, { singleTransaction = true } = {}) {
  const args = ["-v", "ON_ERROR_STOP=1", ...(singleTransaction ? ["--single-transaction"] : []), "-f", file, dbUrl];
  const r = spawnSync("psql", args, { encoding: "utf8", timeout: 120_000 });
  if (r.error) return { ok: false, out: "", err: `could not run psql: ${r.error.message}` };
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** One scalar, as text. */
function scalar(sql) {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql, dbUrl], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`[lockguard] scalar failed: ${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout ?? "").trim();
}

// ------------------------------------------------------------------ results
const results = [];
let failures = 0;
function check(label, pass, detail) {
  results.push({ label, pass, detail });
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

// The body shape this guard was written for: #156 is a constraint SWAP, which
// is the interesting case — the drop succeeds, so a non-atomic failure after it
// would leave the column with NO constraint at all.
const swapBody = (extra = "") => `
alter table ${SCHEMA}.t drop constraint if exists t_kind_check;
alter table ${SCHEMA}.t add constraint t_kind_check check (kind in ('A', 'B', 'C'));
insert into ${SCHEMA}.observed (setting, value)
  values ('lock_timeout', current_setting('lock_timeout')),
         ('statement_timeout', current_setting('statement_timeout'));
${extra}
`;

function constraintValues() {
  return scalar(
    `select coalesce(pg_get_constraintdef(c.oid), '(absent)')
       from pg_namespace n
       join pg_class t on t.relnamespace = n.oid and t.relname = 't'
       left join pg_constraint c on c.conrelid = t.oid and c.conname = 't_kind_check'
      where n.nspname = '${SCHEMA}';`,
  );
}

function ledgerCount() {
  return scalar("select count(*)::text from supabase_migrations.schema_migrations;");
}

async function main() {
  console.log("[lockguard] target: local (disposable)");
  console.log(`[lockguard] guard under test: ${APPLY_GUARD.replace(/\s+/g, " ").trim()}`);

  // The guard the production runner uses must be the guard this probe tests.
  const declared = /lock_timeout = '([^']+)'/.exec(APPLY_GUARD);
  if (!declared || declared[1] !== LOCK_TIMEOUT) {
    console.error(`[lockguard] APPLY_GUARD declares lock_timeout ${declared ? declared[1] : "(none)"}, probe expects ${LOCK_TIMEOUT}`);
    process.exit(2);
  }

  const setup = psqlFile(
    sqlFile(
      "setup.sql",
      `drop schema if exists ${SCHEMA} cascade;
       create schema ${SCHEMA};
       create table ${SCHEMA}.t (id int primary key, kind text not null
         constraint t_kind_check check (kind in ('A', 'B')));
       create table ${SCHEMA}.observed (setting text, value text);
       insert into ${SCHEMA}.t values (1, 'A');`,
    ),
  );
  if (!setup.ok) {
    console.error("[lockguard] setup failed: " + (setup.err || setup.out).slice(-600));
    process.exit(2);
  }

  const ledgerBefore = ledgerCount();
  console.log(`[lockguard] ledger before: ${ledgerBefore} row(s)\n`);

  // ====================================================== A — normal execution
  console.log("[lockguard] A — a guarded body applies normally");
  {
    psqlFile(sqlFile("clear.sql", `delete from ${SCHEMA}.observed;`));
    const t0 = Date.now();
    const r = psqlFile(sqlFile("a.sql", APPLY_GUARD + swapBody()));
    const ms = Date.now() - t0;
    check("A1 · the guarded body succeeds", r.ok, r.ok ? `${ms} ms` : (r.err || r.out).slice(-300));
    check(
      "A2 · …and its DDL took effect — the constraint now permits three values",
      /'C'/.test(constraintValues()),
      constraintValues(),
    );
  }

  // ============================================== B — the guard is in effect
  console.log("\n[lockguard] B — the prepended `set local` governs the body");
  {
    const lt = scalar(`select value from ${SCHEMA}.observed where setting = 'lock_timeout';`);
    const st = scalar(`select value from ${SCHEMA}.observed where setting = 'statement_timeout';`);
    check(
      `B1 · lock_timeout read from INSIDE the body is ${LOCK_TIMEOUT}`,
      lt === LOCK_TIMEOUT,
      `observed "${lt}" — a statement three lines after the \`set local\` sees it`,
    );
    check("B2 · statement_timeout is pinned at 120s, not tightened", st === "2min" || st === "120s", `observed "${st}"`);
  }

  // ================================== C — contention makes the guard fire fast
  console.log("\n[lockguard] C — under contention the guard fails in ~3s, not ~120s");
  let guardedMs = 0;
  {
    const holder = holdLock(8);
    await settle(1500); // let the holder take the lock
    const t0 = Date.now();
    const r = psqlFile(sqlFile("c.sql", APPLY_GUARD + swapBody()));
    guardedMs = Date.now() - t0;
    const msg = (r.err || r.out).replace(/\s+/g, " ");
    check("C1 · the guarded apply FAILED", !r.ok, msg.slice(-220));
    check(
      "C2 · …because of the lock timeout (55P03), not something else",
      /lock timeout|55P03/i.test(msg),
      "the database named the timeout itself",
    );
    check(
      `C3 · …and it gave up in ~${LOCK_TIMEOUT}, nowhere near statement_timeout`,
      guardedMs >= 2000 && guardedMs <= 8000,
      `${guardedMs} ms elapsed (expected ≈3000)`,
    );
    check(
      "C4 · the failed apply changed NOTHING — the constraint is untouched",
      /'C'/.test(constraintValues()),
      constraintValues(),
    );
    await holder;
  }

  // ========================== D — control: the guard is what caused the speed
  console.log("\n[lockguard] D — control: the SAME contention, unguarded, waits it out");
  {
    psqlFile(sqlFile("reset-d.sql", `alter table ${SCHEMA}.t drop constraint if exists t_kind_check;
       alter table ${SCHEMA}.t add constraint t_kind_check check (kind in ('A', 'B'));`));
    const holder = holdLock(6);
    await settle(1500);
    const t0 = Date.now();
    const r = psqlFile(sqlFile("d.sql", swapBody())); // no guard
    const ms = Date.now() - t0;
    check("D1 · the UNGUARDED apply eventually succeeds", r.ok, r.ok ? `${ms} ms` : (r.err || r.out).slice(-300));
    check(
      "D2 · …after waiting longer than the guard would have allowed",
      ms > 2500,
      `${ms} ms unguarded vs ${guardedMs} ms guarded — the difference IS the guard`,
    );
    await holder;
  }

  // ===================================== E — rollback of a half-done body
  console.log("\n[lockguard] E — a late failure rolls back the drop that had succeeded");
  {
    const before = constraintValues();
    // The replacement is DELIBERATELY DIFFERENT from what is there now (it adds
    // 'D'), so this scenario can tell a rollback from a successful re-add. A
    // body that swapped in an identical constraint would leave the same text
    // behind either way and prove nothing.
    //
    // Statement 1 drops the constraint and SUCCEEDS; the last statement fails.
    // Without atomicity the column would be left either unconstrained or
    // carrying 'D'.
    const r = psqlFile(
      sqlFile(
        "e.sql",
        APPLY_GUARD +
          `alter table ${SCHEMA}.t drop constraint if exists t_kind_check;
           alter table ${SCHEMA}.t add constraint t_kind_check check (kind in ('A', 'B', 'C', 'D'));
           select 1 / 0;`,
      ),
    );
    const after = constraintValues();
    check("E1 · the body failed", !r.ok, (r.err || r.out).replace(/\s+/g, " ").slice(-200));
    check(
      "E2 · the constraint is STILL THERE — the successful drop was rolled back",
      after !== "(absent)" && after === before,
      `before: ${before}  ·  after: ${after}`,
    );
    check(
      "E3 · …and it is the OLD one — the replacement did not survive",
      !/'D'/.test(after),
      `"'D'" absent from: ${after}`,
    );
  }

  // ============================================= F — the ledger is never touched
  console.log("\n[lockguard] F — ledger safety");
  {
    const after = ledgerCount();
    check(
      "F1 · the migration ledger is byte-for-byte unchanged across every scenario",
      after === ledgerBefore,
      `${ledgerBefore} before, ${after} after — this probe records nothing, and a failed apply records nothing`,
    );
  }

  // ------------------------------------------------------------------ teardown
  const teardown = psqlFile(sqlFile("teardown.sql", `drop schema if exists ${SCHEMA} cascade;`));
  check("G1 · the probe left nothing behind", teardown.ok && scalarSchemaGone(), "scratch schema dropped");

  console.log("");
  if (failures === 0) {
    console.log(`[lockguard] OK — ${results.length}/${results.length} behaved as designed.`);
    process.exit(0);
  }
  console.error(`[lockguard] FAILED — ${failures} of ${results.length} did not behave as designed:`);
  for (const r of results.filter((x) => !x.pass)) console.error(`  ✗ ${r.label} — ${r.detail ?? ""}`);
  process.exit(1);
}

function scalarSchemaGone() {
  try {
    return scalar(`select count(*)::text from pg_namespace where nspname = '${SCHEMA}';`) === "0";
  } catch {
    return false;
  }
}

/**
 * Hold ACCESS EXCLUSIVE on the probe table for `seconds`, in a session of its
 * own. Resolves when that session exits, so the caller can await the release
 * rather than guess.
 */
function holdLock(seconds) {
  const f = sqlFile(
    `hold-${seconds}.sql`,
    `lock table ${SCHEMA}.t in access exclusive mode;\nselect pg_sleep(${seconds});`,
  );
  return new Promise((resolve) => {
    const p = spawn("psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", f, dbUrl], {
      stdio: "ignore",
    });
    p.on("exit", () => resolve());
    p.on("error", () => resolve());
  });
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

main()
  .catch((e) => {
    console.error("[lockguard] could not run: " + e.message);
    process.exit(2);
  })
  .finally(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
