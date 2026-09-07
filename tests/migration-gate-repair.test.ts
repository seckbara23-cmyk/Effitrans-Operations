/**
 * MIGRATION-GATE-139-141-REPAIR — the migration path, made trustworthy.
 * ---------------------------------------------------------------------------
 * TWO DEFECTS, FOUND BY THE DECISION-GATE AUDIT RATHER THAN BY ANY TEST.
 *
 *   1. The #140 and #141 verifiers each compared a row timestamp against
 *      `supabase_migrations.schema_migrations.inserted_at`. THAT COLUMN DOES
 *      NOT EXIST — the ledger is exactly (version, statements, name). A verifier
 *      is ONE statement, so Postgres planned the whole file and rejected it with
 *      42703, losing every OTHER check in the file too. Nothing caught it,
 *      because a verifier is only ever run against a database that LACKS its
 *      migration, where erroring is the expected answer. The first place anyone
 *      would have learned was the runner's step 3 — on production, after the DDL
 *      had landed, in the `VERIFY_FAILED` state the policy calls indeterminate.
 *
 *   2. `validateTarget` required EXACTLY ONE pending migration. That was never
 *      an ordering rule; it was an assumption that a migration ships with the
 *      code that needs it. Three accumulated, and it refused all three —
 *      including the earliest and correct one. The repository became
 *      undeployable through its own sanctioned path, with no supported way out.
 *
 * Both are now enforcement rather than narrative, and the mutation probes in
 * `probe-migration-gate.mjs` break each guarantee to prove the tests bite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  reconcile,
  validateTarget,
  classify,
  LEDGER_STATUS,
} from "../scripts/migration/ledger.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");
/** JS/TS with comments removed — assertions must read code, not prose. */
const js = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** YAML with comments removed. */
const yml = (p: string) => read(p).replace(/^\s*#.*$/gm, "");

const VERIFIERS_DIR = "supabase/verifiers";
const MIGRATIONS_DIR = "supabase/migrations";

/** The three real pending versions, so the model test is not a toy. */
const V138 = "20260930000001";
const V139 = "20261001000001";
const V140 = "20261002000001";
const V141 = "20261003000001";

const mig = (version: string, verifier = "package.json") => ({
  file: `${version}_x.sql`,
  path: `supabase/migrations/${version}_x.sql`,
  version,
  name: "x",
  verifier,
  malformed: false,
});
const led = (version: string) => ({ version, name: "x" });

/** repo = 138 + the three; ledger = whatever has been applied so far. */
const REPO = [mig(V138), mig(V139), mig(V140), mig(V141)];
const stateFor = (applied: string[]) => {
  const ledger = applied.map(led);
  return { ledger, state: reconcile(REPO, ledger) };
};

// ===========================================================================
// §3 — THE VERIFIER DEFECT, AND THE RULE THAT ENDS IT
// ===========================================================================

describe("a verifier's evidence is the schema, never the ledger", () => {
  const verifiers = readdirSync(fileURLToPath(new URL(`../${VERIFIERS_DIR}`, import.meta.url)))
    .filter((f) => f.endsWith(".verify.sql"));

  it("01 — there are verifiers to check, and none queries supabase_migrations", () => {
    // ⚠ THE DEFECT, as a standing rule. A ban rather than a column whitelist:
    // a whitelist would have to hardcode the ledger's shape without a database
    // and would silently rot. And more fundamentally, a verifier that reads the
    // ledger asks the wrong oracle — the guard runs verifiers PRECISELY BECAUSE
    // the ledger cannot say whether a migration is applied.
    expect(verifiers.length).toBeGreaterThanOrEqual(4);
    for (const f of verifiers) {
      expect(sql(`${VERIFIERS_DIR}/${f}`), f).not.toMatch(/\bsupabase_migrations\b/i);
      expect(sql(`${VERIFIERS_DIR}/${f}`), f).not.toMatch(/\binserted_at\b/);
    }
  });

  it("02 — the lint enforces it, so a future verifier cannot reintroduce it", () => {
    const lint = read("scripts/lint-migrations.mjs");
    expect(lint).toContain("supabase_migrations");
    expect(lint).toContain("a verifier must not query supabase_migrations");
    // …and it strips comments first, or the explanatory note in the repaired
    // verifiers would trip the rule it documents.
    expect(lint).toContain("const strip");
  });

  it("02b — …and the lint's read-only rule is pinned, so it cannot be quietly deleted", () => {
    // Test 03 below scans the verifiers THAT EXIST. The lint scans the ones
    // that will exist. Deleting the lint's rule leaves today's files clean and
    // tomorrow's unguarded, and nothing would have noticed — which is exactly
    // the shape of the defect this whole programme is about: a control that is
    // only ever asked a question it cannot fail.
    //
    // Found by an adversarial probe (§15.14) whose own first cut was wrong: it
    // disabled the lint and then asked only the lint, so of course the lint
    // passed. The probe now runs the suite, and the suite now has this.
    const lint = read("scripts/lint-migrations.mjs");
    expect(lint).toContain("verifiers must be strictly read-only");
    // Read the rule list as TEXT rather than matching it with a regex. The
    // thing under assertion IS a list of regexes, and writing a regex to match
    // regexes is how the first cut of this test asserted a backspace character
    // by accident — `\b` inside a template literal is not a word boundary.
    const at = lint.indexOf("const MUTATING");
    expect(at, "the read-only rule list must still exist").toBeGreaterThan(-1);
    const rules = lint.slice(at, at + 400);
    for (const verb of ["insert", "update", "delete", "truncate", "alter", "drop", "grant", "revoke", "create"]) {
      expect(rules, `the read-only ban must still cover ${verb}`).toContain(verb);
    }
    // …and the two rules that are not simple verbs: a session or role change,
    // and an anonymous DO block, which can write without naming a verb.
    expect(rules, "session and role changes must still be banned").toContain("(set|reset)");
    expect(rules, "anonymous DO blocks must still be banned").toContain("do");
  });

  it("03 — every verifier still meets the read-only, one-row contract", () => {
    for (const f of verifiers) {
      const v = sql(`${VERIFIERS_DIR}/${f}`);
      expect(v, f).toMatch(/\bas ok\b/);
      expect(v, f).toMatch(/\bas detail\b/);
      expect(v, f).not.toMatch(/^\s*(insert|update|delete|truncate|alter|drop|grant|revoke|create)\s+/im);
      expect(v, f).not.toMatch(/\bdo\s+\$\$/i);
    }
  });

  it("04 — the repaired postcondition is not a weakening: it asserts the MECHANISM", () => {
    // The provenance question ("was this backfilled?") is not durably answerable
    // from data once operators can legitimately fill the field in. So the
    // concern is split: the MIGRATION asserts zero rows at the moment of
    // application, and the VERIFIER asserts that nothing in the database can
    // populate the field behind an operator — no default, no trigger.
    for (const [v, table, col] of [
      [`${VERIFIERS_DIR}/20261002000001_dossier_service_scope.verify.sql`, "operational_file", "services"],
      [`${VERIFIERS_DIR}/20261003000001_staff_professional_identity.verify.sql`, "workforce_profile", "first_name"],
    ] as const) {
      const body = sql(v);
      expect(body, v).toContain("column_default is not null");
      expect(body, v).toContain("pg_trigger");
      expect(body, v).toContain("pg_proc");
      expect(body, v).toContain("prosrc");
      expect(body, v).toContain(table);
      expect(body, v).toContain(col);
    }
    // And the apply-time half still exists, where it can actually run.
    for (const m of [
      `${MIGRATIONS_DIR}/20261002000001_dossier_service_scope.sql`,
      `${MIGRATIONS_DIR}/20261003000001_staff_professional_identity.sql`,
    ]) {
      expect(read(m), m).toContain("must not backfill");
      expect(read(m), m).toContain("raise exception");
    }
  });

  it("05 — CI runs every verifier against a database that HAS its migration", () => {
    // The gap that let the defect through: verifiers were only ever executed
    // against databases missing their objects.
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("scripts/verify-migrations.mjs");
    expect(ci).toContain("Every migration verifier passes against the applied schema");
    // It must run AFTER the reset that applies them, and before the rehearsal
    // that mutates the ledger.
    expect(ci.indexOf("Reset DB")).toBeLessThan(ci.indexOf("verify-migrations.mjs"));

    const runner = read("scripts/verify-migrations.mjs");
    // ok must be exactly true — a truthy non-boolean has not met the contract.
    expect(runner).toContain("ok !== true");
    // A verifier that ERRORS against an applied database is a failure, never a
    // shrug. That distinction is the whole point.
    expect(runner).toContain("the verifier could not run");
    // Structurally incapable of mutating anything — asserted against the CODE,
    // because the header comment names both verbs to explain their absence.
    const runnerCode = js("scripts/verify-migrations.mjs");
    expect(runnerCode).not.toContain("applyFile");
    expect(runnerCode).not.toMatch(/\brepair\b/);
    expect(runnerCode).toContain("queryFile");

    // It checks the verifiers of APPLIED migrations only. For a migration that
    // is not applied, the verifier erroring is the CORRECT answer — the objects
    // are genuinely absent — so treating that as a failure would make the tool
    // useless against production, where a pending backlog is normal. In CI the
    // filter removes nothing: `db reset` applies everything.
    expect(runnerCode).toContain("remoteLedger");
    expect(runnerCode).toContain("applied.has(m.version)");
  });
});

// ===========================================================================
// §9/§10 — THE APPLIED-PREFIX / PENDING-SUFFIX MODEL
// ===========================================================================

describe("pending is not corruption; a hole in the applied prefix is", () => {
  it("06 — today's production shape is CLEAN_WITH_PENDING, not an incident", () => {
    const { state } = stateFor([V138]);
    const shape = classify(state);
    expect(shape.status).toBe(LEDGER_STATUS.CLEAN_WITH_PENDING);
    expect(shape.appliedThrough).toBe(V138);
    expect(shape.pending).toEqual([V139, V140, V141]);
    expect(shape.earliestPending).toBe(V139);
    expect(shape.suffixIntact).toBe(true);
    expect(state.hard).toEqual([]);
  });

  it("07 — nothing pending is CLEAN", () => {
    const shape = classify(stateFor([V138, V139, V140, V141]).state);
    expect(shape.status).toBe(LEDGER_STATUS.CLEAN);
    expect(shape.earliestPending).toBeNull();
  });

  it("08 — ⚠ a HOLE in the applied prefix is HELD, whatever the pending count", () => {
    // The September 2026 condition: a migration behind the maximum that the
    // ledger does not know. Applied-and-unrecorded and never-applied look
    // identical from the ledger, which is why the guard never guesses.
    const { state } = stateFor([V138, V140]); // 139 skipped
    const shape = classify(state);
    expect(shape.status).toBe(LEDGER_STATUS.HELD);
    expect(state.hard.map((h) => h.code)).toContain("MISSING_REMOTELY_BEHIND_MAX");
  });

  it("09 — an applied version with no repository file is HELD", () => {
    const { state } = stateFor([V138, "20261009000001"]);
    expect(classify(state).status).toBe(LEDGER_STATUS.HELD);
    expect(state.hard.map((h) => h.code)).toContain("UNKNOWN_REMOTE_VERSION");
  });

  it("10 — the guard asserts the structure ALWAYS, and a count only on request", () => {
    const guard = read("scripts/migration-integrity.mjs");
    expect(guard).toContain("PENDING_NOT_A_SUFFIX");
    expect(guard).toContain("expectPending: null");
    expect(guard).toContain("args.expectPending !== null");
    expect(guard).toContain(LEDGER_STATUS.CLEAN_WITH_PENDING);
    // Still structurally incapable of changing anything (code, not comments).
    const guardCode = js("scripts/migration-integrity.mjs");
    expect(guardCode).not.toContain("applyFile");
    expect(guardCode).not.toContain("repair(");
  });

  it("11 — the deployment workflow no longer hardcodes a pending count", () => {
    // The comment explains what it USED to assert, so read the YAML without it.
    const wf = yml(".github/workflows/migrate-production.yml");
    expect(wf).not.toContain("--expect-pending");
    expect(wf).toContain("scripts/migration-integrity.mjs --linked");
    // Ordering moved to where it is actually enforceable.
    expect(wf).toContain("ordering is the runner's");
  });
});

// ===========================================================================
// §14 — THE PROMOTION SEQUENCE 138 → 139 → 140 → 141
// ===========================================================================

describe("the ordered promotion, modelled on the real version numbers", () => {
  it("12 — STATE A (production today): #140 and #141 are REFUSED, #139 is allowed", () => {
    const { ledger, state } = stateFor([V138]);
    expect(validateTarget(V140, REPO, ledger, state).join(" ")).toMatch(/not the earliest pending/);
    expect(validateTarget(V141, REPO, ledger, state).join(" ")).toMatch(/not the earliest pending/);
    expect(validateTarget(V139, REPO, ledger, state)).toEqual([]);
  });

  it("13 — STATE B (after #139): #141 is REFUSED, #140 is allowed", () => {
    const { ledger, state } = stateFor([V138, V139]);
    expect(classify(state).pending).toEqual([V140, V141]);
    expect(validateTarget(V141, REPO, ledger, state).join(" ")).toMatch(/not the earliest pending/);
    expect(validateTarget(V140, REPO, ledger, state)).toEqual([]);
  });

  it("14 — STATE C (after #140): #141 is allowed and is the last", () => {
    const { ledger, state } = stateFor([V138, V139, V140]);
    expect(classify(state).pending).toEqual([V141]);
    expect(validateTarget(V141, REPO, ledger, state)).toEqual([]);
  });

  it("15 — STATE D (after #141): nothing is due, and asking again is refused", () => {
    const { ledger, state } = stateFor([V138, V139, V140, V141]);
    expect(classify(state).status).toBe(LEDGER_STATUS.CLEAN);
    expect(validateTarget(V141, REPO, ledger, state).join(" ")).toMatch(/not greater than/);
  });

  it("16 — the refusal names everything an operator needs, at the worst moment", () => {
    const { ledger, state } = stateFor([V138]);
    const msg = validateTarget(V141, REPO, ledger, state).join(" ");
    expect(msg).toContain(`requested=${V141}`);
    expect(msg).toContain(`earliest allowed=${V139}`);
    expect(msg).toContain(`production max applied=${V138}`);
    expect(msg).toContain(`remaining pending=[${V139}, ${V140}, ${V141}]`);
    expect(msg).toContain("one migration per approved production action");
  });

  it("17 — a hole anywhere refuses EVERY target, including the hole itself", () => {
    const { ledger, state } = stateFor([V138, V140]);
    for (const t of [V139, V141]) {
      expect(validateTarget(t, REPO, ledger, state).join(" "), t).toMatch(/integrity is not clean/);
    }
  });
});

// ===========================================================================
// §12/§13 — ONE MIGRATION PER APPROVAL, AND CONSERVATIVE FAILURE
// ===========================================================================

describe("nothing batches, and nothing records before it verifies", () => {
  it("18 — the runner applies exactly one version, and there is no batch path", () => {
    const runner = js("scripts/migrate-production.mjs");
    expect(runner).toContain("--version");
    // ⚠ Whole flags, not substrings: `--all` is a substring of the legitimate
    // `--allow-dirty-tree`, and a naive check fails for a reason that has
    // nothing to do with batching.
    for (const flag of ["--all", "--include-all", "--batch", "--every"]) {
      expect(runner.match(new RegExp(`"${flag}"`)), flag).toBeNull();
    }
    for (const forbidden of ["applyAll", "for (const m of repo)"]) {
      expect(runner, forbidden).not.toContain(forbidden);
    }
    // Exactly one apply call in the whole runner.
    expect((runner.match(/applyFile\(/g) ?? []).length).toBe(1);
    const wf = read(".github/workflows/migrate-production.yml");
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("name: production-db");
    // One version input, not a list.
    expect(wf).toContain("Migration version to apply (14 digits");
  });

  it("19 — the ledger is written only AFTER the verifier passes", () => {
    const runner = read("scripts/migrate-production.mjs");
    const verify = runner.indexOf("step 3 — verify postconditions");
    const record = runner.indexOf("step 4 — record in the ledger");
    expect(verify).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(verify);
    // And a failed verify stops before recording.
    expect(runner).toContain("The ledger was NOT written");
  });

  it("20 — every failure state is named, and none of them is a silent success", () => {
    const runner = read("scripts/migrate-production.mjs");
    for (const state of [
      "NOT_APPLIED", "VERIFY_FAILED", "SCHEMA_AHEAD_OF_LEDGER",
      "POST_RECORD_MISMATCH", "PREFLIGHT_REFUSED",
    ]) {
      expect(runner, state).toContain(state);
    }
    expect(runner).toContain("do not improvise a rollback");
  });

  it("21 — nothing in the toolchain writes the ledger with SQL", () => {
    for (const f of [
      "scripts/migrate-production.mjs",
      "scripts/migration-integrity.mjs",
      "scripts/verify-migrations.mjs",
      "scripts/migration/ledger.mjs",
      "scripts/migration/exec.mjs",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/insert\s+into\s+supabase_migrations/i);
      expect(src, f).not.toMatch(/delete\s+from\s+supabase_migrations/i);
      expect(src, f).not.toMatch(/update\s+supabase_migrations/i);
    }
    // Recording happens through the supported mechanism and nothing else.
    expect(read("scripts/migration/exec.mjs")).toContain('"migration", "repair"');
  });

  it("22 — every migration from the cutover still has a committed verifier", () => {
    for (const v of [V138, V139, V140, V141]) {
      const dir = fileURLToPath(new URL(`../${VERIFIERS_DIR}`, import.meta.url));
      const found = readdirSync(dir).some((f) => f.startsWith(`${v}_`) && f.endsWith(".verify.sql"));
      expect(found, `${v} needs a companion verifier`).toBe(true);
    }
    // The runner refuses to apply one without it, before touching anything.
    const { ledger, state } = stateFor([V138]);
    const noVerifier = [mig(V138), mig(V139, "does/not/exist.sql"), mig(V140), mig(V141)];
    expect(validateTarget(V139, noVerifier, ledger, reconcile(noVerifier, ledger)).join(" "))
      .toMatch(/verifier/);
  });
});

// ===========================================================================
// §19 — the identity feature's compatibility behaviour is untouched
// ===========================================================================

describe("this programme changed the migration path and nothing else", () => {
  it("23 — the schema-138 identity compatibility mode is preserved", () => {
    const panel = read("components/users/user-identity-panel.tsx");
    expect(panel).toContain("{storable ? (");
    expect(panel).toContain("20261003000001");
    expect(panel).toContain("pas encore disponibles");
    expect(read("lib/users/identity-141.ts")).toContain("42703");
    expect(read("lib/users/actions.ts")).toContain("identity_schema_unavailable");
  });

  it("24 — and the three migrations themselves are unchanged by this repair", () => {
    // The repair touched verifiers and tooling. A migration whose SQL changed
    // after review is a different migration.
    for (const [f, marker] of [
      ["20261001000001_gainde_declaration_and_tax_payment.sql", "record_gainde_registration"],
      ["20261002000001_dossier_service_scope.sql", "operational_file_services_known"],
      ["20261003000001_staff_professional_identity.sql", "workforce_profile_identity_shape"],
    ] as const) {
      expect(existsSync(fileURLToPath(new URL(`../${MIGRATIONS_DIR}/${f}`, import.meta.url)))).toBe(true);
      expect(read(`${MIGRATIONS_DIR}/${f}`), f).toContain(marker);
    }
    // #140 and #141 carry an explicit NOT-APPLIED banner because they were
    // authored knowing they would sit pending. #139 predates that habit and
    // says so in the policy document instead — asserting it here would be
    // asserting a convention it never adopted.
    for (const f of [
      "20261002000001_dossier_service_scope.sql",
      "20261003000001_staff_professional_identity.sql",
    ]) {
      expect(read(`${MIGRATIONS_DIR}/${f}`), f).toContain("NOT APPLIED");
    }
    expect(read("docs/migration-policy.md"))
      .toContain("Migration #139 must not be deployed");
  });
});
