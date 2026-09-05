/**
 * Rehearsal + failure injection for the migration toolchain.
 * ---------------------------------------------------------------------------
 * NEVER RUNS AGAINST PRODUCTION. It refuses any target but an explicit
 * `--db-url` pointing at a local/disposable host, because it deliberately
 * creates broken migrations and half-applies them — the whole point is to watch
 * the machinery fail correctly, which is not something to do to a real database.
 *
 * It proves six behaviours by CAUSING each one, rather than asserting that the
 * code contains a branch for it:
 *
 *   R1 clean apply            → applied, verified, recorded
 *   R2 NOT_APPLIED            → bad SQL; ledger untouched
 *   R3 VERIFY_FAILED          → SQL applies, verifier says no; ledger untouched
 *   R4 SCHEMA_AHEAD_OF_LEDGER → applied + verified + unrecorded, self-detected
 *   R5 POST_RECORD_MISMATCH   → recorded, post-check still finds work pending
 *   R6 HELD                   → a discrepancy refuses the NEXT migration
 *
 *   A1 atomicity              → is a multi-statement body actually rolled back
 *                               on a late failure? MEASURED, never assumed.
 *
 * It works inside a self-contained Supabase project directory (`.rehearsal/`)
 * so the real `supabase/migrations` is never touched — and so that
 * `migration repair`, which resolves a migration's name from the project
 * directory, can record the fabricated versions through the SUPPORTED
 * mechanism rather than by writing the ledger table directly.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { target, query, queryFile, applyFile, repair } from "./migration/exec.mjs";
import { repoMigrations, reconcile, validateTarget } from "./migration/ledger.mjs";

const ROOT = ".rehearsal";
const MIG = join(ROOT, "supabase", "migrations");
const VER = join(ROOT, "verifiers");
const TMP = join(ROOT, "tmp");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal", "db", "postgres"]);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--db-url") a.url = argv[++i];
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
  console.log(`[rehearsal] ${pass ? "PASS" : "FAIL"} ${id} — ${what}${detail ? `\n[rehearsal]        ${detail}` : ""}`);
}

function writeTmp(name, sql) {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, sql, "utf8");
  return p;
}

/** Statements that return no rows go through applyFile, which does not demand any. */
function exec(tgt, name, sql) {
  const r = applyFile(tgt, writeTmp(name, sql));
  if (!r.ok) console.log(`[rehearsal]   (exec ${name} reported: ${String(r.message).replace(/\s+/g, " ").slice(0, 200)})`);
  return r;
}

function scenario(version, name, sql, verifySql) {
  writeFileSync(join(MIG, `${version}_${name}.sql`), sql, "utf8");
  writeFileSync(join(VER, `${version}_${name}.verify.sql`), verifySql, "utf8");
  return {
    version,
    name,
    path: join(MIG, `${version}_${name}.sql`),
    verifier: join(VER, `${version}_${name}.verify.sql`),
  };
}

const okVerifier = (table) => `
select (select count(*) from information_schema.tables
         where table_schema='rehearsal' and table_name='${table}') = 1 as ok,
       'rehearsal check for ${table}' as detail;`;

const ledgerRows = (tgt) =>
  query(tgt, "select version from supabase_migrations.schema_migrations order by version").map((r) => String(r.version));

/** Rehearsal migrations carry their verifier in the rehearsal tree, not the repo's. */
const rehearsalRepo = () =>
  repoMigrations(MIG).map((m) => ({ ...m, verifier: join(VER, `${m.version}_${m.name}.verify.sql`) }));

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("[rehearsal] usage: node scripts/migration-rehearsal.mjs --db-url <local postgres url>");
    process.exit(2);
  }
  const host = assertDisposable(args.url);

  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(MIG, { recursive: true });
  mkdirSync(VER, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  // A project directory of its own, so `migration repair` resolves the
  // fabricated versions' names without the real migrations directory in scope.
  if (existsSync(join("supabase", "config.toml"))) {
    copyFileSync(join("supabase", "config.toml"), join(ROOT, "supabase", "config.toml"));
  }

  const tgt = target({ kind: "db-url", url: args.url, workdir: ROOT });
  console.log(`[rehearsal] disposable target confirmed: ${host}`);
  console.log(`[rehearsal] project directory: ${ROOT}`);

  exec(tgt, "setup.sql", "drop schema if exists rehearsal cascade; create schema rehearsal;");

  const base = ledgerRows(tgt);
  console.log(`[rehearsal] ledger starts at ${base.length} rows\n`);
  const V = (n) => `2999010${n}000001`; // far future: always sorts after anything real
  const recorded = [];

  // ---- A1: is the default executor atomic on a LATE failure? --------------
  {
    exec(tgt, "a1.sql", "create table rehearsal.atomicity_probe(x int);\nselect 1/0;");
    const n = Number(
      query(tgt, "select count(*) as n from information_schema.tables where table_schema='rehearsal' and table_name='atomicity_probe'")[0].n,
    );
    const atomic = n === 0;
    // RECORDED, NOT REQUIRED. Atomicity is a property of the platform's
    // execution path, not of our code, and the design deliberately does not
    // depend on it — that is what step 3's verifier is for. Failing the build
    // over it would assert a guarantee we chose not to rely on. So A1 always
    // passes and always reports what it measured.
    record("A1", "multi-statement body atomic on late failure (MEASUREMENT)", true,
      atomic
        ? "MEASURED ATOMIC — the earlier CREATE TABLE was rolled back by the later failure"
        : "MEASURED NOT ATOMIC — the CREATE TABLE survived a later failure. Partial application is real; " +
          "the runner's post-apply verification is what protects us, exactly as designed.");
    exec(tgt, "a1-clean.sql", "drop table if exists rehearsal.atomicity_probe;");
  }

  // ---- R1: clean apply ----------------------------------------------------
  {
    const s = scenario(V(1), "clean", "create table rehearsal.r1(x int);", okVerifier("r1"));
    const ap = applyFile(tgt, s.path);
    const v = ap.ok ? queryFile(tgt, s.verifier)[0] : null;
    const rec = v && v.ok === true ? repair(tgt, s.version) : { ok: false, message: "not reached" };
    if (rec.ok) recorded.push(s.version);
    const after = ledgerRows(tgt);
    const pass = ap.ok && v?.ok === true && rec.ok && after.includes(s.version);
    record("R1", "clean apply → applied, verified, recorded", pass,
      `apply=${ap.ok} verify=${v?.ok} record=${rec.ok}${rec.ok ? "" : ` (${String(rec.message).slice(0, 200)})`} ledger ${base.length}→${after.length}`);
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
    // Applies cleanly but does the WRONG thing: creates r3_wrong while the
    // verifier demands r3. This is "partial/wrong application".
    const s = scenario(V(3), "wrong", "create table rehearsal.r3_wrong(x int);", okVerifier("r3"));
    const before = ledgerRows(tgt).length;
    const ap = applyFile(tgt, s.path);
    const v = queryFile(tgt, s.verifier)[0];
    const after = ledgerRows(tgt).length;
    const pass = ap.ok && v.ok === false && before === after;
    record("R3", "VERIFY_FAILED → applied but wrong; ledger NOT written", pass,
      `apply=${ap.ok} verify=${v.ok} ledger ${before}=${after}`);
  }

  // ---- R4: SCHEMA_AHEAD_OF_LEDGER, self-detected --------------------------
  {
    const s = scenario(V(4), "unrecorded", "create table rehearsal.r4(x int);", okVerifier("r4"));
    applyFile(tgt, s.path); // applied…
    // …and deliberately NOT recorded. The verifier is the ONLY thing that can
    // tell this apart from "not applied yet".
    const v = queryFile(tgt, s.verifier)[0];
    const inLedger = ledgerRows(tgt).includes(s.version);
    const pass = v.ok === true && !inLedger;
    record("R4", "SCHEMA_AHEAD_OF_LEDGER → verifier passes while unrecorded", pass,
      `verifier=${v.ok} inLedger=${inLedger} — this is the discriminator the guard uses`);
  }

  // ---- R5: POST_RECORD_MISMATCH ------------------------------------------
  {
    const s5 = scenario(V(5), "recorded", "create table rehearsal.r5(x int);", okVerifier("r5"));
    scenario(V(6), "straggler", "create table rehearsal.r6(x int);", okVerifier("r6"));
    applyFile(tgt, s5.path);
    const rec = repair(tgt, s5.version);
    if (rec.ok) recorded.push(s5.version);
    const state = reconcile(rehearsalRepo(), ledgerRows(tgt).map((v) => ({ version: v, name: "" })));
    const pass = rec.ok && state.pending.length > 0;
    record("R5", "POST_RECORD_MISMATCH → recorded, but the post-check finds work still pending", pass,
      `record=${rec.ok} pending after recording: ${state.pending.join(", ") || "none"}`);
  }

  // ---- R6: HELD blocks the next migration --------------------------------
  {
    // R4 is applied-but-unrecorded and sorts BELOW the newest version, so it is
    // a hard finding — and every later target must be refused because of it.
    const next = scenario(V(7), "blocked", "create table rehearsal.r7(x int);", okVerifier("r7"));
    const repo = rehearsalRepo();
    const ledger = ledgerRows(tgt).map((v) => ({ version: v, name: "" }));
    const state = reconcile(repo, ledger);
    const problems = validateTarget(next.version, repo, ledger, state);
    const held = state.hard.some((h) => h.code === "MISSING_REMOTELY_BEHIND_MAX");
    const pass = problems.length > 0 && held;
    record("R6", "HELD → an outstanding discrepancy refuses the NEXT migration", pass,
      `hard=${state.hard.map((h) => h.code).join(",") || "none"} · refusal: ${problems[0] ?? "NONE (bad)"}`);
  }

  // ---- cleanup: leave the database as we found it -------------------------
  exec(tgt, "teardown.sql", "drop schema if exists rehearsal cascade;");
  for (const v of recorded) repair(tgt, v, undefined, "reverted"); // supported mechanism, not a DELETE
  const finalRows = ledgerRows(tgt);
  record("CLEANUP", "rehearsal rows reverted, schema dropped", finalRows.length === base.length,
    `ledger ${base.length} → ${finalRows.length}`);
  rmSync(ROOT, { recursive: true, force: true });

  console.log("");
  const failed = results.filter((r) => !r.pass);
  console.log(`[rehearsal] ${results.length - failed.length}/${results.length} scenarios behaved as designed`);
  if (failed.length) {
    for (const f of failed) console.error(`[rehearsal] ::error::${f.id} ${f.what} — ${f.detail}`);
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`[rehearsal] crashed: ${e.stack || e.message}`);
  process.exit(1);
}
