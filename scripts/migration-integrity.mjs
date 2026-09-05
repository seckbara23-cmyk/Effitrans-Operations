/**
 * Migration-integrity guard — READ ONLY, ALWAYS.
 * ---------------------------------------------------------------------------
 * This script detects. It never repairs and never applies. It imports only
 * `query` from the exec layer; `applyFile` and `repair` are deliberately not
 * imported, so there is no code path here that can change anything, and a test
 * asserts that this file mentions neither.
 *
 * WHAT IT IS FOR. Between 2026-09-15 and 2026-09-30 sixteen migrations were
 * applied to production and none was recorded. Nothing failed, nothing alerted,
 * and the discrepancy surfaced only because somebody happened to read the
 * ledger. This job is the thing that would have said so on day one.
 *
 * SCHEMA-AHEAD-OF-LEDGER IS SELF-DETECTED. The most dangerous state — the SQL
 * ran but the ledger does not know — cannot be found by comparing two lists,
 * because a missing ledger row looks identical whether the migration was
 * applied or skipped. So for each unrecorded migration the guard runs that
 * migration's own companion verifier: read-only, and the only evidence that
 * distinguishes "applied but unrecorded" (an incident) from "not yet applied"
 * (ordinary). Nobody has to remember to check.
 *
 * EXIT CODES  0 clean · 1 integrity failure (HELD) · 2 could not run the check.
 *
 * Usage:
 *   node scripts/migration-integrity.mjs --linked
 *   node scripts/migration-integrity.mjs --db-url "$DATABASE_URL" --expect-pending 1
 */
import { existsSync } from "node:fs";
import { target, query, queryFile } from "./migration/exec.mjs";
import { repoMigrations, remoteLedger, reconcile, crossCheckCli } from "./migration/ledger.mjs";

function parseArgs(argv) {
  const a = { expectPending: 0, dir: "supabase/migrations" };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--linked") a.target = { kind: "linked" };
    else if (v === "--local") a.target = { kind: "local" };
    else if (v === "--db-url") a.target = { kind: "db-url", url: argv[++i] };
    else if (v === "--project-ref") a.target = { kind: "project-ref", ref: argv[++i] };
    else if (v === "--expect-pending") a.expectPending = Number(argv[++i]);
    else if (v === "--dir") a.dir = argv[++i];
    else if (v === "--json") a.json = true;
  }
  return a;
}

const log = (s = "") => console.log(s);
const fail = [];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error("[integrity] a target is required: --linked | --local | --db-url <url> | --project-ref <ref>");
    process.exit(2);
  }

  let tgt, repo, ledger, state;
  try {
    tgt = target(args.target);
    repo = repoMigrations(args.dir);
    ledger = remoteLedger(tgt);
    state = reconcile(repo, ledger);
  } catch (e) {
    console.error(`[integrity] could not complete the check: ${e.message}`);
    process.exit(2);
  }

  log(`[integrity] target      : ${tgt.label}`);
  log(`[integrity] repository  : ${state.repoCount} migrations`);
  log(`[integrity] ledger      : ${state.ledgerCount} rows, max ${state.remoteMax || "(empty)"}`);
  log(`[integrity] pending     : ${state.pending.length}${state.pending.length ? ` (${state.pending.join(", ")})` : ""}`);
  log("");

  for (const h of state.hard) {
    fail.push(`${h.code} ${h.version} — ${h.detail}`);
  }

  // The pending count must match what this run expects. Outside a deployment
  // the expectation is zero; a deployment expects exactly its own migration.
  if (state.pending.length !== args.expectPending) {
    fail.push(
      `UNEXPECTED_PENDING_COUNT — expected ${args.expectPending}, found ${state.pending.length}` +
        (state.pending.length ? ` (${state.pending.join(", ")})` : ""),
    );
  }

  // ---- schema-ahead-of-ledger, established by evidence rather than assumed ---
  for (const version of state.pending) {
    const m = repo.find((x) => x.version === version);
    if (!m || !existsSync(m.verifier)) {
      log(`[integrity] ${version}: no verifier — cannot tell applied from not-applied`);
      continue;
    }
    let verdict;
    try {
      const rows = queryFile(tgt, m.verifier);
      verdict = rows.length === 1 ? rows[0] : null;
    } catch (e) {
      // A verifier that errors against a database missing the objects is the
      // NORMAL not-yet-applied case, not a guard failure.
      log(`[integrity] ${version}: verifier could not run (consistent with not applied) — ${short(e.message)}`);
      continue;
    }
    if (verdict && verdict.ok === true) {
      fail.push(
        `SCHEMA_AHEAD_OF_LEDGER ${version} — its verifier passes against this database, so the ` +
          `migration IS applied but is not recorded in the ledger. Record it with ` +
          `\`supabase migration repair --status applied ${version}\` after confirming; do NOT re-apply the SQL.`,
      );
    } else {
      log(`[integrity] ${version}: not applied (verifier ok=${verdict ? verdict.ok : "no row"}) — normal for a pending migration`);
    }
  }

  // ---- our reading vs the CLI's ------------------------------------------
  const cross = crossCheckCli(tgt, state.pending);
  if (cross.checked && !cross.agrees) {
    fail.push(`CLI_DISAGREES — supabase migration list reports a different pending set (${cross.detail})`);
  } else if (cross.checked) {
    log(`[integrity] CLI cross-check: ${cross.detail}`);
  }

  log("");
  for (const a of state.advisory) log(`[integrity] advisory: ${a.code} ${a.version} — ${a.detail}`);

  if (fail.length) {
    log("");
    console.error(`[integrity] FAILED — ${fail.length} finding(s). Migrations are HELD until resolved.`);
    for (const f of fail) console.error(`  ✗ ${f}`);
    console.error("");
    console.error("[integrity] This guard never repairs or applies anything. Resolve deliberately.");
    process.exit(1);
  }

  log(`[integrity] OK — repository and ledger agree; ${args.expectPending} pending as expected.`);
  process.exit(0);
}

function short(s) {
  return String(s).replace(/\s+/g, " ").slice(0, 160);
}

main();
