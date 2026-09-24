/**
 * UAT-PARALLEL-OWNERSHIP-01-VERIFIER-FIX — adversarial probe for the
 * `20261006000001` companion verifier's SECURITY assertion.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. On 2026-09-24 the production runner applied this migration's
 * SQL and then FAILED its verifier, leaving production schema-ahead-of-ledger on
 * a database that was correctly protected the whole time. The verifier had
 * asserted the absence of table GRANTS, but this platform grants
 * `arwdDxtm` on every table in `public` to anon and authenticated by default
 * privileges and enforces with RLS. The check asked a layer that does not
 * answer the question.
 *
 * A green CI run had signed that check off, because the local stack does not
 * carry those default privileges. So the regression that matters is not "does
 * the verifier pass" — it did — but "does it still pass when the database looks
 * like PRODUCTION, and does it fail for each way the protection could actually
 * be lost". That is what this probe measures, one injected state at a time.
 *
 * IT RUNS THE REAL VERIFIER FILE. Nothing here re-implements the assertion: a
 * copy would drift from the thing it claims to guard, and the drift would be
 * invisible for exactly as long as it mattered.
 *
 * DISPOSABLE TARGETS ONLY. It disables RLS and creates write policies on
 * purpose. It refuses any host that is not local, and every injected state is
 * reverted in a `finally`.
 *
 * Usage:
 *   node scripts/verifier-security-probe.mjs --db-url "postgresql://…@127.0.0.1:54322/postgres"
 */
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { target, query, queryFile, applyFile, repair } from "./migration/exec.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "20261006000001";
const MIGRATION = join(ROOT, `supabase/migrations/${VERSION}_parallel_activity_owning_roles.sql`);
const VERIFIER = join(ROOT, `supabase/verifiers/${VERSION}_parallel_activity_owning_roles.verify.sql`);
const TABLE = "public.process_step_owning_role";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "db", "postgres"]);
const TMP = mkdtempSync(join(tmpdir(), "verifier-probe-"));

let failures = 0;
let ran = 0;

function assertDisposable(url) {
  let host = "";
  try {
    host = new URL(String(url).replace(/^postgres(ql)?:\/\//, "http://")).hostname;
  } catch {
    host = "";
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    console.error(`[probe] REFUSED: "${host || url}" is not a disposable local database.`);
    console.error("[probe] This script disables RLS and creates write policies on purpose.");
    process.exit(2);
  }
  return host;
}

/** One statement per call — the --db-url path speaks the extended query protocol. */
function exec(tgt, name, sql) {
  const f = join(TMP, `${name}.sql`);
  writeFileSync(f, sql, "utf8");
  const r = applyFile(tgt, f);
  if (!r.ok) throw new Error(`[probe] setup statement "${name}" failed: ${r.message}`);
}

/** The REAL verifier, against whatever state the caller has just built. */
function verdict(tgt) {
  const rows = queryFile(tgt, VERIFIER);
  if (rows.length !== 1) throw new Error("[probe] verifier did not return exactly one row");
  return rows[0];
}

function check(label, expectOk, actual) {
  ran++;
  const pass = actual.ok === expectOk;
  if (!pass) failures++;
  const mark = pass ? "✅" : "🚨";
  console.log(`  ${mark} ${label}`);
  console.log(`      expected ok=${expectOk}, got ok=${actual.ok} — ${String(actual.detail).slice(0, 160)}`);
}

/** Inject a state, run the verifier, and ALWAYS put the database back. */
function injected(tgt, label, setupSql, teardownSql, expectOk) {
  exec(tgt, `setup-${label.replace(/\W+/g, "-")}`, setupSql);
  try {
    check(label, expectOk, verdict(tgt));
  } finally {
    exec(tgt, `teardown-${label.replace(/\W+/g, "-")}`, teardownSql);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let url = null;
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--db-url") url = argv[++i];
  if (!url) {
    console.error("[probe] usage: node scripts/verifier-security-probe.mjs --db-url <local postgres url>");
    process.exit(2);
  }
  const host = assertDisposable(url);
  const tgt = target({ kind: "db-url", url, workdir: ROOT });
  console.log(`[probe] target: ${host} (disposable)`);
  console.log(`[probe] verifier under test: ${VERSION}\n`);

  // The migration is `insert … on conflict do nothing`, so applying it against a
  // database that already has it is a no-op. This makes the probe independent of
  // whether the caller reset the stack first.
  const ap = applyFile(tgt, MIGRATION);
  if (!ap.ok) throw new Error(`[probe] could not apply ${VERSION}: ${ap.message}`);

  // ---- 1 + 8: the production-shaped state ---------------------------------
  // Broad table grants are what production HAS. Granting them here is the whole
  // point: under the old check this alone turned the verifier red.
  console.log("[probe] A — the state production is actually in");
  exec(tgt, "grant-broad", `grant all on ${TABLE} to anon, authenticated`);
  check("1+8 · broad GRANTs + RLS + SELECT-only policy + 29 correct rows → PASS", true, verdict(tgt));

  // The regression, stated as a measurement rather than a memory: the assertion
  // that failed Run #8, evaluated against this same correct state.
  const old = query(
    tgt,
    `select not has_table_privilege('authenticated','${TABLE}','INSERT')
        and not has_table_privilege('authenticated','${TABLE}','UPDATE')
        and not has_table_privilege('authenticated','${TABLE}','DELETE')
        and not has_table_privilege('anon','${TABLE}','INSERT')
        and not has_table_privilege('anon','${TABLE}','UPDATE')
        and not has_table_privilege('anon','${TABLE}','DELETE') as ok`,
  )[0];
  ran++;
  if (old.ok === false) {
    console.log("  ✅ 1b · the OLD grant-based assertion is FALSE on this correct state — the incident, reproduced");
  } else {
    failures++;
    console.log("  🚨 1b · the OLD assertion did not reproduce the failure; this probe is not exercising the incident");
  }

  // ---- 2: RLS disabled ----------------------------------------------------
  console.log("\n[probe] B — each way the protection could actually be lost");
  injected(
    tgt,
    "2 · RLS disabled → FAIL",
    `alter table ${TABLE} disable row level security`,
    `alter table ${TABLE} enable row level security`,
    false,
  );

  // ---- 3/4/5: a write policy naming authenticated -------------------------
  for (const [n, cmd] of [["3", "insert"], ["4", "update"], ["5", "delete"]]) {
    const pol = `probe_${cmd}`;
    const body = cmd === "insert" ? "with check (true)" : "using (true)";
    injected(
      tgt,
      `${n} · authenticated ${cmd.toUpperCase()} policy → FAIL`,
      `create policy ${pol} on ${TABLE} for ${cmd} to authenticated ${body}`,
      `drop policy ${pol} on ${TABLE}`,
      false,
    );
  }

  // ---- 6: reached through PUBLIC, and through ALL -------------------------
  injected(
    tgt,
    "6a · write policy granted to PUBLIC → FAIL",
    `create policy probe_public on ${TABLE} for insert to public with check (true)`,
    `drop policy probe_public on ${TABLE}`,
    false,
  );
  injected(
    tgt,
    "6b · FOR ALL policy naming authenticated → FAIL",
    `create policy probe_all on ${TABLE} for all to authenticated using (true)`,
    `drop policy probe_all on ${TABLE}`,
    false,
  );
  // A RESTRICTIVE write policy grants nothing, so it must NOT be read as one.
  injected(
    tgt,
    "6c · RESTRICTIVE write policy grants nothing → still PASS",
    `create policy probe_restrictive on ${TABLE} as restrictive for insert to authenticated with check (false)`,
    `drop policy probe_restrictive on ${TABLE}`,
    true,
  );
  // The other half of the contract: forbidding writes must not pass a table
  // nobody can read — that would break clause F-1 instead of protecting it.
  injected(
    tgt,
    "6d · the SELECT policy removed → FAIL",
    `drop policy process_step_owning_role_select on ${TABLE}`,
    `create policy process_step_owning_role_select on ${TABLE} for select to authenticated using (true)`,
    false,
  );

  // ---- 7: the ownership data itself ---------------------------------------
  console.log("\n[probe] C — the data postconditions");
  injected(
    tgt,
    "7a · an ownership row removed → FAIL",
    `delete from ${TABLE} where step_key = 'pre_gate'`,
    `insert into ${TABLE} (step_key, role_code, note) values ('pre_gate','ACCOUNT_MANAGER','restored by probe') on conflict do nothing`,
    false,
  );
  injected(
    tgt,
    "7b · an activity owned by the WRONG role → FAIL",
    `update ${TABLE} set role_code = 'COORDINATOR' where step_key = 'bon_a_delivrer'`,
    `update ${TABLE} set role_code = 'ACCOUNT_MANAGER' where step_key = 'bon_a_delivrer'`,
    false,
  );

  // ---- 9: the guard must see schema-ahead-of-ledger ------------------------
  console.log("\n[probe] D — the integrity guard, on a ledger missing this row");
  const reverted = repair(tgt, VERSION, undefined, "reverted");
  if (!reverted.ok) {
    failures++;
    ran++;
    console.log(`  🚨 9 · could not withdraw the ledger row: ${reverted.message}`);
  } else {
    try {
      let out = "";
      let code = 0;
      try {
        out = execFileSync(
          process.execPath,
          [join(ROOT, "scripts/migration-integrity.mjs"), "--db-url", url],
          { encoding: "utf8", cwd: ROOT },
        );
      } catch (e) {
        out = (e.stdout || "") + (e.stderr || "");
        code = e.status ?? 1;
      }
      ran++;
      const sawAhead = /SCHEMA_AHEAD_OF_LEDGER/.test(out);
      const heldNotClean = code !== 0;
      if (sawAhead && heldNotClean) {
        console.log("  ✅ 9 · applied-but-unrecorded → SCHEMA_AHEAD_OF_LEDGER, guard HELD (exit 1)");
      } else {
        failures++;
        console.log(`  🚨 9 · guard did not flag it — exit=${code}, SCHEMA_AHEAD seen=${sawAhead}`);
        console.log(out.split("\n").filter((l) => l.includes("[integrity]")).slice(-6).join("\n"));
      }
    } finally {
      const back = repair(tgt, VERSION, undefined, "applied");
      if (!back.ok) console.error(`[probe] ⚠ could not restore the ledger row: ${back.message}`);
    }
  }

  // ---- the database must be exactly as we found it ------------------------
  console.log("\n[probe] E — the probe left nothing behind");
  const after = verdict(tgt);
  ran++;
  if (after.ok === true) {
    console.log("  ✅ final state restored — the verifier passes again");
  } else {
    failures++;
    console.log(`  🚨 the probe did not restore the database: ${after.detail}`);
  }

  console.log("\n" + "=".repeat(74));
  console.log(`[probe] ${ran - failures}/${ran} checks passed`);
  console.log("=".repeat(74));
  if (failures) process.exit(1);
  process.exit(0);
}

main();
