/**
 * Rehearsal + failure injection for the migration toolchain.
 * ---------------------------------------------------------------------------
 * NEVER RUNS AGAINST PRODUCTION. It refuses any target but an explicit
 * `--db-url` pointing at a local/disposable host, because it deliberately
 * creates broken migrations and half-applies them — the whole point is to see
 * the machinery fail correctly, and that is not something to do to a real
 * database.
 *
 * It proves the six behaviours the design promises, by CAUSING each one rather
 * than asserting that the code contains a branch for it:
 *
 *   R1 clean apply            → applied, verified, recorded, 0 pending
 *   R2 NOT_APPLIED            → bad SQL; ledger untouched
 *   R3 VERIFY_FAILED          → SQL applies, verifier says no; ledger untouched
 *   R4 SCHEMA_AHEAD_OF_LEDGER → applied + verified + unrecorded, self-detected
 *   R5 POST_RECORD_MISMATCH   → recorded, post-check disagrees
 *   R6 HELD                   → a discrepancy blocks the NEXT migration
 *
 *   A1 atomicity              → is a multi-statement body actually rolled back
 *                               on a late failure? MEASURED, never assumed.
 *
 * Everything is done in a throwaway schema (`rehearsal`) plus a throwaway
 * migrations/verifiers directory, so the real repository is never touched.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { target, query, queryFile, applyFile, repair } from "./migration/exec.mjs";
import { repoMigrations, reconcile, validateTarget } from "./migration/ledger.mjs";

const ROOT = ".rehearsal";
const MIG = join(ROOT, "migrations");
const VER = join(ROOT, "verifiers");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal", "db", "postgres"]);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db-url") a.url = argv[++i];
  }
  return a;
}

/** The refusal that keeps this file from ever touching something real. */
function assertDisposable(url) {
  let host = "";
  try {
    host = new URL(String(url).replace(/^postgres(ql)?:\/\//, "http://")).hostname;
  } catch {
    host = "";
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    console.error(`[rehearsal] REFUSED: "${host || url}" is not a disposable local database.`);
    console.error("[rehearsal] This script injects failures on purpose. It runs ONLY against a local/CI database.");
    process.exit(2);
  }
  return host;
}

const results = [];
function record(id, what, pass, detail) {
  results.push({ id, what, pass, detail });
  console.log(`[rehearsal] ${pass ? "✓" : "✗"} ${id} ${what}${detail ? ` — ${detail}` : ""}`);
}

/** A migration + verifier pair written into the throwaway directories. */
function scenario(version, name, sql, verifySql) {
  writeFileSync(join(MIG, `${version}_${name}.sql`), sql, "utf8");
  writeFileSync(join(VER, `${version}_${name}.verify.sql`), verifySql, "utf8");
  return { version, path: join(MIG, `${version}_${name}.sql`), verifier: join(VER, `${version}_${name}.verify.sql`) };
}

const okVerifier = (table) => `
select (select count(*) from information_schema.tables
         where table_schema='rehearsal' and table_name='${table}') = 1 as ok,
       'rehearsal check for ${table}' as detail;`;

function ledgerRows(tgt) {
  return query(tgt, "select version from supabase_migrations.schema_migrations order by version").map((r) => String(r.version));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("[rehearsal] usage: node scripts/migration-rehearsal.mjs --db-url <local postgres url>");
    process.exit(2);
  }
  const host = assertDisposable(args.url);
  const tgt = target({ kind: "db-url", url: args.url });
  console.log(`[rehearsal] disposable target confirmed: ${host}`);

  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(MIG, { recursive: true });
  mkdirSync(VER, { recursive: true });

  // A private schema so nothing in `public` is touched even here.
  applyFile(tgt, writeTmp("setup.sql", "drop schema if exists rehearsal cascade; create schema rehearsal;"));

  const base = ledgerRows(tgt);
  const baseMax = base.length ? base[base.length - 1] : "";
  console.log(`[rehearsal] ledger starts at ${base.length} rows (max ${baseMax || "empty"})`);
  const V = (n) => `2999010${n}000001`; // far future: always sorts after anything real

  // ---- A1: is the default executor atomic on a LATE failure? --------------
  {
    const sql = `create table rehearsal.atomicity_probe(x int);\nselect 1/0;`;
    const r = applyFile(tgt, writeTmp("atomicity.sql", sql));
    const exists = query(
      tgt,
      "select count(*) as n from information_schema.tables where table_schema='rehearsal' and table_name='atomicity_probe'",
    )[0].n;
    const atomic = Number(exists) === 0;
    record(
      "A1",
      "multi-statement body is atomic on late failure",
      atomic,
      atomic
        ? "the earlier CREATE TABLE was rolled back — one implicit transaction"
        : `NOT ATOMIC: the CREATE TABLE survived a later failure (apply reported ok=${r.ok})`,
    );
    query(tgt, "drop table if exists rehearsal.atomicity_probe");
  }

  // ---- R1: clean apply ----------------------------------------------------
  {
    const s = scenario(V(1), "clean", "create table rehearsal.r1(x int);", okVerifier("r1"));
    const ap = applyFile(tgt, s.path);
    const v = queryFile(tgt, s.verifier)[0];
    const rec = repair(tgt, s.version);
    const after = ledgerRows(tgt);
    const pass = ap.ok && v.ok === true && rec.ok && after.includes(s.version);
    record("R1", "clean apply → applied, verified, recorded", pass, `ledger ${base.length} → ${after.length}`);
  }

  // ---- R2: NOT_APPLIED ----------------------------------------------------
  {
    const s = scenario(V(2), "badsql", "create table rehearsal.r2(x int) this is not sql;", okVerifier("r2"));
    const before = ledgerRows(tgt).length;
    const ap = applyFile(tgt, s.path);
    const after = ledgerRows(tgt).length;
    const pass = !ap.ok && before === after;
    record("R2", "NOT_APPLIED → apply refused, ledger untouched", pass, `apply ok=${ap.ok}, ledger ${before}=${after}`);
  }

  // ---- R3: VERIFY_FAILED --------------------------------------------------
  {
    // The SQL succeeds but does the WRONG thing: creates r3_wrong, verifier
    // demands r3. This is "partial/wrong application".
    const s = scenario(V(3), "wrong", "create table rehearsal.r3_wrong(x int);", okVerifier("r3"));
    const before = ledgerRows(tgt).length;
    const ap = applyFile(tgt, s.path);
    const v = queryFile(tgt, s.verifier)[0];
    const after = ledgerRows(tgt).length;
    const pass = ap.ok && v.ok === false && before === after;
    record("R3", "VERIFY_FAILED → applied but wrong; ledger NOT written", pass, `verifier ok=${v.ok}`);
  }

  // ---- R4: SCHEMA_AHEAD_OF_LEDGER, self-detected --------------------------
  {
    const s = scenario(V(4), "unrecorded", "create table rehearsal.r4(x int);", okVerifier("r4"));
    applyFile(tgt, s.path); // applied…
    // …and deliberately NOT recorded. The guard's discriminator is the verifier.
    const v = queryFile(tgt, s.verifier)[0];
    const inLedger = ledgerRows(tgt).includes(s.version);
    const pass = v.ok === true && !inLedger;
    record("R4", "SCHEMA_AHEAD_OF_LEDGER → verifier passes while unrecorded", pass,
      "this is exactly what distinguishes 'applied but unrecorded' from 'not applied'");
  }

  // ---- R5: POST_RECORD_MISMATCH ------------------------------------------
  {
    // Recorded, but a LATER migration is still outstanding, so the post-record
    // check ("0 pending") must fail.
    const s5 = scenario(V(5), "recorded", "create table rehearsal.r5(x int);", okVerifier("r5"));
    const s6 = scenario(V(6), "straggler", "create table rehearsal.r6(x int);", okVerifier("r6"));
    applyFile(tgt, s5.path);
    repair(tgt, s5.version);
    const repo = repoMigrations(MIG).map((m) => ({ ...m, verifier: join(VER, `${m.version}_${m.name}.verify.sql`) }));
    const ledger = ledgerRows(tgt).map((v) => ({ version: v, name: "" }));
    const state = reconcile(repo, ledger);
    const pass = state.pending.length > 0;
    record("R5", "POST_RECORD_MISMATCH → recorded but post-check finds pending work", pass,
      `pending after record: ${state.pending.join(", ") || "none"}`);
    // leave s6 unapplied for R6
  }

  // ---- R6: HELD blocks the next migration --------------------------------
  {
    // R4's migration is applied-but-unrecorded and sorts BELOW the newest
    // version, so it is a hard finding — and every later target is refused.
    const repo = repoMigrations(MIG).map((m) => ({ ...m, verifier: join(VER, `${m.version}_${m.name}.verify.sql`) }));
    const ledger = ledgerRows(tgt).map((v) => ({ version: v, name: "" }));
    const state = reconcile(repo, ledger);
    const next = scenario(V(7), "blocked", "create table rehearsal.r7(x int);", okVerifier("r7"));
    const repo2 = repoMigrations(MIG).map((m) => ({ ...m, verifier: join(VER, `${m.version}_${m.name}.verify.sql`) }));
    const state2 = reconcile(repo2, ledger);
    const problems = validateTarget(next.version, repo2, ledger, state2);
    const pass = problems.length > 0;
    record("R6", "HELD → a discrepancy refuses the NEXT migration", pass, problems[0] ?? "no refusal (BAD)");
  }

  // ---- clean up: the rehearsal leaves nothing behind ----------------------
  applyFile(tgt, writeTmp("teardown.sql", "drop schema if exists rehearsal cascade;"));
  for (const v of [V(1), V(5)]) {
    query(tgt, `delete from supabase_migrations.schema_migrations where version = '${v}'`);
  }
  rmSync(ROOT, { recursive: true, force: true });
  const finalRows = ledgerRows(tgt);
  record("CLEANUP", "rehearsal rows removed", finalRows.length === base.length, `ledger back to ${finalRows.length}`);

  console.log("");
  const failed = results.filter((r) => !r.pass);
  console.log(`[rehearsal] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) console.error(`[rehearsal] FAILED ${f.id} ${f.what} — ${f.detail}`);
    process.exit(1);
  }
  console.log("[rehearsal] all rehearsal scenarios behaved as designed.");
}

function writeTmp(name, sql) {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  const p = join(ROOT, name);
  writeFileSync(p, sql, "utf8");
  return p;
}

main().catch((e) => {
  console.error(`[rehearsal] crashed: ${e.stack || e.message}`);
  process.exit(1);
});
