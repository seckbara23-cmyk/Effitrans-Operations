/**
 * Measure whether the PRODUCTION executor is atomic on a late failure.
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM THE REHEARSAL. The CI rehearsal targets a local
 * database over `--db-url`, which the CLI drives with the extended query
 * protocol — a prepared statement, one command per message. It rejects a
 * multi-statement body outright ("cannot insert multiple commands into a
 * prepared statement"). Production goes through `--linked`, the Management API,
 * which accepts a whole migration file at once.
 *
 * Two different protocols. An atomicity result from the local path would be a
 * confident answer about the wrong executor, which is worse than no answer.
 *
 * So this runs against a REAL Supabase project over the same Management API the
 * production runner uses — a staging project, never production — and confines
 * itself to a scratch schema it creates and drops.
 *
 * Usage:
 *   node scripts/measure-atomicity.mjs --project-ref <staging-ref>
 *
 * It REFUSES the production ref outright.
 */
import { target, query, applyFile } from "./migration/exec.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Production. Never a valid target for a script that deliberately fails SQL. */
const PRODUCTION_REF = "xtpppzhkiagdpmnghdlc";

const args = process.argv.slice(2);
let ref = "";
for (let i = 0; i < args.length; i++) if (args[i] === "--project-ref") ref = args[++i];

if (!ref) {
  console.error("[atomicity] usage: node scripts/measure-atomicity.mjs --project-ref <staging-ref>");
  process.exit(2);
}
if (ref === PRODUCTION_REF) {
  console.error("[atomicity] REFUSED: that is the production project.");
  console.error("[atomicity] This script deliberately runs failing SQL. Point it at staging.");
  process.exit(2);
}

const tgt = target({ kind: "project-ref", ref });
const dir = mkdtempSync(join(tmpdir(), "eft-atomicity-"));
const sqlFile = (name, sql) => {
  const p = join(dir, name);
  writeFileSync(p, sql, "utf8");
  return p;
};

const SCHEMA = "atomicity_probe_scratch";
let exitCode = 0;

try {
  console.log(`[atomicity] target: project ${ref} (Management API — the production executor)`);

  // Clean slate, then a POSITIVE CONTROL: the same CREATE on its own must work,
  // so that "absent" in the real measurement means rolled back, not never run.
  applyFile(tgt, sqlFile("reset.sql", `drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA};`));
  const control = applyFile(tgt, sqlFile("control.sql", `create table ${SCHEMA}.probe(x int);`));
  const controlPresent = Number(
    query(tgt, `select count(*) as n from information_schema.tables where table_schema='${SCHEMA}' and table_name='probe'`)[0].n,
  );
  if (!control.ok || controlPresent !== 1) {
    throw new Error(`positive control failed (ok=${control.ok}, present=${controlPresent}) — the measurement would be meaningless`);
  }
  console.log("[atomicity] positive control: the probe table can be created on its own ✓");
  applyFile(tgt, sqlFile("clean.sql", `drop table ${SCHEMA}.probe;`));

  // THE MEASUREMENT: a multi-statement body whose LAST statement fails.
  const late = applyFile(tgt, sqlFile("late.sql", `create table ${SCHEMA}.probe(x int);\nselect 1/0;`));
  if (late.ok) throw new Error("the probe did not fail — `select 1/0` was expected to raise");
  if (!/division|zero/i.test(String(late.message))) {
    throw new Error(`the probe failed for the WRONG reason: ${String(late.message).slice(0, 300)}`);
  }
  const survived = Number(
    query(tgt, `select count(*) as n from information_schema.tables where table_schema='${SCHEMA}' and table_name='probe'`)[0].n,
  );

  console.log("");
  if (survived === 0) {
    console.log("[atomicity] RESULT: ATOMIC");
    console.log("[atomicity] The earlier CREATE TABLE was rolled back by the later failure, so the");
    console.log("[atomicity] Management API runs a multi-statement body as ONE implicit transaction.");
    console.log("[atomicity] The design does not depend on this — post-apply verification is what");
    console.log("[atomicity] protects us — but a failed apply most likely leaves nothing behind.");
  } else {
    console.log("[atomicity] RESULT: NOT ATOMIC");
    console.log("[atomicity] The CREATE TABLE SURVIVED a later failure: a failed apply can leave");
    console.log("[atomicity] production partially changed. NOT_APPLIED must therefore be treated as");
    console.log("[atomicity] 'state unknown, verify before retrying', exactly as the runbook says.");
    exitCode = 0; // a finding, not a failure — we measure, we do not require
  }
} catch (e) {
  console.error(`[atomicity] could not complete the measurement: ${e.message}`);
  exitCode = 1;
} finally {
  try {
    applyFile(tgt, sqlFile("teardown.sql", `drop schema if exists ${SCHEMA} cascade;`));
    console.log(`[atomicity] scratch schema ${SCHEMA} dropped`);
  } catch {
    console.error(`[atomicity] WARNING: could not drop ${SCHEMA} — remove it by hand`);
  }
  rmSync(dir, { recursive: true, force: true });
}

process.exit(exitCode);
