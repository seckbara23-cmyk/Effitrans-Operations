/**
 * MIG-LEDGER-151 — the guard that blocked its own remedy.
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED. Production workflow #19 was dispatched in RECORD ONLY mode to
 * record 20261013000001, which had applied in #18 and never been written to the
 * ledger. It stopped at the pre-execution integrity guard, on the
 * `SCHEMA_AHEAD_OF_LEDGER` finding it had been dispatched to resolve. The
 * record step was skipped. Nothing was applied and nothing was recorded.
 *
 * The guard was not wrong — it correctly refuses to let a migration land on top
 * of a ledger that disagrees with the repository. It was simply ordered ahead
 * of the one mode whose entire purpose is to END that disagreement, which made
 * the recovery unreachable.
 *
 * THE FIX IS AN ORDERING FIX, NOT A WEAKENING, and these tests exist to keep it
 * that way. APPLY and DRY RUN must stay gated; RECORD ONLY must reach its own
 * preconditions, which are stricter and more specific than the gate they
 * replace; and the guard must still run AFTERWARDS, mandatorily, where a
 * reconciliation that did not reconcile goes red.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const WORKFLOW = read(".github/workflows/migrate-production.yml");
const RUNNER = read("scripts/migrate-production.mjs");

/** The record-only branch of the runner, bounded so a neighbour cannot satisfy a pin. */
function recordOnlyBranch(): string {
  const start = RUNNER.indexOf("if (args.recordOnly) {");
  const end = RUNNER.indexOf("if (pre && pre.ok === true) {", start);
  expect(start, "the record-only branch is missing").toBeGreaterThan(-1);
  expect(end, "the record-only branch has no terminator").toBeGreaterThan(start);
  return RUNNER.slice(start, end);
}

/** One workflow step, by name, bounded at the next step. */
function step(name: string): string {
  const i = WORKFLOW.indexOf(`- name: ${name}`);
  expect(i, `workflow step '${name}' not found`).toBeGreaterThan(-1);
  // Bounded at the NEXT step regardless of indentation. An earlier version
  // required a six-space indent and over-ran into the following step, so a pin
  // asserting "this step has no continue-on-error" read its neighbour's.
  const next = WORKFLOW.indexOf("- name: ", i + 1);
  const raw = WORKFLOW.slice(i, next === -1 ? undefined : next);
  // COMMENTS STRIPPED. A step's slice runs up to the next `- name:`, which means
  // it carries the COMMENT BLOCK that introduces the following step — and the
  // comment above "Post-run integrity report" explains `continue-on-error`. The
  // first version of this helper therefore made "this step tolerates no
  // failure" fail by reading its neighbour's prose. Pins read YAML, not essays.
  return raw.replace(/^\s*#.*$/gm, "");
}

describe("MIG-LEDGER-151 — APPLY and DRY RUN stay guarded", () => {
  const guard = step("Migration-integrity guard (structural; ordering is the runner's)");

  it("01 — the pre-execution guard still exists and still runs the real guard", () => {
    expect(guard).toContain("node scripts/migration-integrity.mjs --linked");
  });

  it("02 — it is skipped ONLY for record-only, never for apply or dry run", () => {
    // The condition must be exactly this: any broader skip would ungate an apply.
    expect(guard).toContain("if: ${{ !inputs.record_only }}");
    expect(guard).not.toMatch(/continue-on-error/);
    expect(guard).not.toMatch(/\|\|\s*true/);
  });

  it("03 — APPLY is still reached only with the guard ahead of it", () => {
    const apply = step("Apply, verify, record, re-verify");
    expect(apply).toContain("if: ${{ !inputs.dry_run && !inputs.record_only }}");
    // Ordering is what was wrong; assert it explicitly.
    expect(WORKFLOW.indexOf("- name: Migration-integrity guard"))
      .toBeLessThan(WORKFLOW.indexOf("- name: Apply, verify, record, re-verify"));
  });

  it("04 — DRY RUN is still reached only with the guard ahead of it", () => {
    const dry = step("Dry run");
    expect(dry).toContain("if: ${{ inputs.dry_run && !inputs.record_only }}");
    expect(WORKFLOW.indexOf("- name: Migration-integrity guard"))
      .toBeLessThan(WORKFLOW.indexOf("- name: Dry run"));
  });

  it("05 — the guard is not disabled by any other means", () => {
    expect(guard).not.toMatch(/if:\s*\$\{\{\s*false/);
    // And no NEW input exists that could turn it off. Asserted as the exact
    // input set rather than by hunting for suspicious words — "force" appears
    // in this workflow's own prose about never cancelling in progress, and a
    // keyword search would have failed on an explanation.
    const block = WORKFLOW.slice(WORKFLOW.indexOf("    inputs:"), WORKFLOW.indexOf("concurrency:"));
    const inputs = [...block.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
    expect(inputs.sort()).toEqual(["dry_run", "reason", "record_only", "version"]);
  });
});

describe("MIG-LEDGER-151 — RECORD ONLY reaches its own preconditions", () => {
  it("06 — the record step runs, and the pre-gate no longer precedes it blockingly", () => {
    const rec = step("Record only (ledger reconciliation, no apply)");
    expect(rec).toContain("if: ${{ inputs.record_only }}");
    expect(rec).toContain("--record-only");
  });

  it("07 — it requires the live verifier to pass before anything else", () => {
    const b = recordOnlyBranch();
    expect(b).toMatch(/verifier does NOT pass/);
    // Recording an unapplied migration is the September 2026 gap in reverse.
    expect(b).toMatch(/pre\.ok !== true/);
  });

  it("08 — it requires EXACTLY ONE missing entry, and that it is the target", () => {
    const b = recordOnlyBranch();
    expect(b).toContain("state.pending.length !== 1");
    expect(b).toContain("state.pending[0] !== version");
  });

  it("09 — it requires the ledger to be exactly one row behind the repository", () => {
    expect(recordOnlyBranch()).toContain("state.ledgerCount !== state.repoCount - 1");
  });

  it("10 — it refuses any structural finding it does not address", () => {
    // Unknown and duplicate remote versions are `reconcile` hard findings; a
    // record-only run must not paper over them.
    const b = recordOnlyBranch();
    expect(b).toContain("state.hard.length");
    expect(b).toMatch(/does not address/);
  });

  it("11 — it confirms the row's absence against the database, not a derived view", () => {
    expect(recordOnlyBranch()).toMatch(/isRecorded\(tgt, version\)/);
  });

  it("12 — it proves the historical encoding before recording", () => {
    const b = recordOnlyBranch();
    expect(b).toContain("proveFormat");
    expect(b.indexOf("proveFormat")).toBeLessThan(b.indexOf("recordOne("));
    expect(b).toMatch(/could not be proven/);
  });
});

describe("MIG-LEDGER-151 — RECORD ONLY cannot execute migration SQL", () => {
  it("13 — the branch never calls applyFile", () => {
    expect(recordOnlyBranch()).not.toContain("applyFile");
  });

  it("14 — and it exits before the apply branch is ever reached", () => {
    const b = recordOnlyBranch();
    expect(b).toContain("process.exit(0)");
    // The apply step of the runner lives after this branch; the branch must not
    // fall through into it.
    expect(RUNNER.indexOf("step 2 — apply SQL")).toBeGreaterThan(RUNNER.indexOf("if (args.recordOnly) {"));
  });

  it("15 — the workflow never passes --record-only to an applying step", () => {
    const apply = step("Apply, verify, record, re-verify");
    const dry = step("Dry run");
    expect(apply).not.toContain("--record-only");
    expect(dry).not.toContain("--record-only");
  });

  it("16 — record_only wins over dry_run, so a default dispatch cannot no-op", () => {
    expect(step("Dry run")).toContain("!inputs.record_only");
  });
});

describe("MIG-LEDGER-151 — post-record integrity is mandatory", () => {
  const post = step("Record-only must leave integrity CLEAN");

  it("17 — the guard runs again after recording, for record-only runs", () => {
    expect(post).toContain("if: ${{ inputs.record_only }}");
    expect(post).toContain("node scripts/migration-integrity.mjs --linked");
  });

  it("18 — and it is NOT tolerated failing", () => {
    // No continue-on-error, no `|| true`: a reconciliation that did not
    // reconcile must turn the run red.
    expect(post).not.toMatch(/continue-on-error/);
    expect(post).not.toMatch(/\|\|\s*true/);
  });

  it("19 — it runs AFTER the record step", () => {
    expect(WORKFLOW.indexOf("- name: Record only (ledger reconciliation, no apply)"))
      .toBeLessThan(WORKFLOW.indexOf("- name: Record-only must leave integrity CLEAN"));
  });

  it("20 — the pre-existing post-run report is still mandatory for every mode", () => {
    expect(WORKFLOW).toContain("- name: Post-run integrity report");
    expect(WORKFLOW).toContain("steps.post_integrity.outcome != 'success'");
    expect(WORKFLOW).toContain("Production state is NOT confirmed clean by this run.");
  });

  it("21 — the runner itself asserts the expected end state", () => {
    const b = recordOnlyBranch();
    expect(b).toContain("after.pending.length !== 0");
    expect(b).toContain("LEDGER_STATUS.CLEAN");
    expect(b).toContain("is still absent from the ledger");
    expect(b).toContain("STATE.POST_MISMATCH");
  });
});

describe("MIG-LEDGER-151 — wrong target, wrong version, wrong state fail closed", () => {
  it("22 — a local target is refused: its ledger is written by db reset", () => {
    const b = recordOnlyBranch();
    expect(b).toMatch(/tgt\.kind === "local"/);
    expect(b).toMatch(/refuses the local target/);
  });

  it("23 — no target is ever defaulted, so production cannot be reached implicitly", () => {
    expect(read("scripts/migration/exec.mjs")).toContain("[exec] a target is required");
    expect(RUNNER).toMatch(/if \(!args\.target \|\| !args\.version\)/);
  });

  it("24 — the workflow only ever names the linked target", () => {
    const rec = step("Record only (ledger reconciliation, no apply)");
    expect(rec).toContain("--linked");
    expect(rec).not.toMatch(/--db-url|--local/);
  });

  it("25 — a wrong version fails closed at preflight, before any ledger read", () => {
    expect(RUNNER).toContain("no committed migration file for version");
    // And at the record-only gate, if it is not the single pending one.
    expect(recordOnlyBranch()).toContain("not the requested");
  });

  it("26 — an already-recorded version is refused rather than duplicated", () => {
    expect(recordOnlyBranch()).toMatch(/is ALREADY in the ledger/);
  });

  it("27 — every refusal says nothing was written", () => {
    expect(recordOnlyBranch()).toMatch(/Nothing was written/);
  });

  it("28 — the approval gate is unchanged for all modes", () => {
    expect(WORKFLOW).toMatch(/environment:\s*\n\s*name: production-db/);
    // One environment block, so no mode can have been given its own.
    expect(WORKFLOW.match(/name: production-db/g) ?? []).toHaveLength(1);
  });

  it("29 — no migration was added, and no dossier is named", () => {
    // This fix is workflow + runner only. A migration added here would put the
    // repair inside the thing being repaired. The runner DOES name
    // 20261013000001 in its comments, which is documentation of the incident,
    // not a hard-coded target: the version it records comes from --version, and
    // the precondition is "the single pending one", never a literal.
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".verify.sql"));
    expect(files).toHaveLength(151);
    const branch = recordOnlyBranch();
    expect(branch).not.toMatch(/version\s*===\s*["']20261013000001["']/);
    expect(branch).toContain("state.pending[0] !== version");
    for (const src of [RUNNER, WORKFLOW]) {
      expect(src).not.toContain("EFT-IMP-2026-00014");
      expect(src).not.toContain("3021c009");
    }
  });
});
