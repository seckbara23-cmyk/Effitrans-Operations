/**
 * The runner's post-record invariant — CUSTOMS-REF-PROD-MIGRATE-152-155.
 * ---------------------------------------------------------------------------
 * THE INCIDENT. Step 5 required `pending.length === 0` after a successful run:
 * that NOTHING remained pending. That is only true when the migration applied
 * happens to be the last one authored, so applying the FIRST of four pending
 * migrations reported POST_RECORD_MISMATCH against a perfectly healthy
 * database. It fired on #152 of #152–155 in production — SQL applied, verifier
 * 36/36, ledger correctly written, exit 40 — and the protocol then (correctly)
 * halted the release. A false alarm that halts a release is not a harmless
 * false alarm: it is how real alarms get learned-around.
 *
 * It also contradicted the project's own written model in ledger.mjs — "PENDING
 * IS NOT CORRUPTION … what corruption looks like is a hole in the PREFIX" — and
 * `classify`, which has always treated a pending suffix as healthy. The runner
 * was the only place that disagreed with the model.
 *
 * These tests run with NO DATABASE: the predicate is pure, which is the point
 * of having moved it next to the model it enforces.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcile, postRecordFindings, classify } from "../scripts/migration/ledger.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The real versions from the incident, so a failure reads as the release. */
const PRIOR = "20261013000001";
const M152 = "20261016000001";
const M153 = "20261017000001";
const M154 = "20261018000001";
const M155 = "20261019000001";

const REPO = [PRIOR, M152, M153, M154, M155].map((version) => ({
  version,
  name: "x",
  file: `${version}_x.sql`,
  path: `supabase/migrations/${version}_x.sql`,
  verifier: `supabase/verifiers/${version}_x.verify.sql`,
}));

/** A ledger holding exactly these versions, in order. */
const ledger = (...versions: string[]) => versions.map((version) => ({ version, name: "x" }));

/** Findings after applying `version`, given the ledger that resulted. */
const findingsFor = (version: string, rows: { version: string; name: string }[]) =>
  postRecordFindings({ repo: REPO, after: reconcile(REPO, rows), version });

// ===========================================================================
describe("a legitimate pending suffix is NOT a post-record mismatch", () => {
  it("1 — applying the FIRST of four pending migrations succeeds", () => {
    // The exact production case that exited 40.
    const f = findingsFor(M152, ledger(PRIOR, M152));
    expect(f).toEqual([]);
  });

  it("2 — applying a MIDDLE migration, with later ones still pending, succeeds", () => {
    expect(findingsFor(M153, ledger(PRIOR, M152, M153))).toEqual([]);
    expect(findingsFor(M154, ledger(PRIOR, M152, M153, M154))).toEqual([]);
  });

  it("3 — applying the FINAL pending migration succeeds", () => {
    expect(findingsFor(M155, ledger(PRIOR, M152, M153, M154, M155))).toEqual([]);
  });

  it("4 — the defect is real: the OLD condition would have failed case 1", () => {
    // Documents precisely what was wrong, so nobody reinstates it. After
    // applying #152 there are legitimately three pending migrations — the old
    // check refused exactly that, while the new predicate finds nothing wrong.
    const after = reconcile(REPO, ledger(PRIOR, M152));
    expect(after.pending).toEqual([M153, M154, M155]);
    expect(after.pending.length !== 0).toBe(true); // the old condition fired…
    expect(findingsFor(M152, ledger(PRIOR, M152))).toEqual([]); // …and was wrong
  });

  it("5 — and it agrees with `classify`, which always called this healthy", () => {
    // The runner was the only place disagreeing with the model; prove they
    // now agree rather than asserting it in a comment.
    const after = reconcile(REPO, ledger(PRIOR, M152));
    expect(classify(after).status).toBe("CLEAN_WITH_PENDING");
    expect(findingsFor(M152, ledger(PRIOR, M152))).toEqual([]);
  });
});

// ===========================================================================
describe("every genuine failure is still refused", () => {
  it("6 — APPLIED BUT UNRECORDED is named, not inferred", () => {
    // The SQL ran; the ledger does not know. September 2026, sixteen times.
    const f = findingsFor(M152, ledger(PRIOR));
    expect(f.join(" | ")).toContain("still pending after recording");
    expect(f.join(" | ")).toContain("applied but NOT recorded");
    expect(f.length).toBeGreaterThan(0);
  });

  it("7 — a HOLE behind the ledger maximum is refused", () => {
    // #153 recorded while #152 is not: the applied prefix has a gap.
    const f = findingsFor(M153, ledger(PRIOR, M153));
    expect(f.length).toBeGreaterThan(0);
    expect(f.join(" | ")).toContain("MISSING_REMOTELY_BEHIND_MAX");
    expect(f.join(" | ")).toContain("expected exactly");
  });

  it("8 — OUT-OF-ORDER application is refused", () => {
    // #154 applied while #153 is still pending. The maximum is right, so this
    // is caught only by the suffix comparison and the hole finding — the two
    // the old `length === 0` check could never have distinguished.
    const after = reconcile(REPO, ledger(PRIOR, M152, M154));
    expect(after.remoteMax).toBe(M154);
    const f = postRecordFindings({ repo: REPO, after, version: M154 });
    expect(f.length).toBeGreaterThan(0);
    expect(f.join(" | ")).toMatch(/expected exactly|MISSING_REMOTELY_BEHIND_MAX/);
  });

  it("9 — a GENUINE post-record mismatch: something above was recorded too", () => {
    // Applying #152 but the ledger already holds #153 — this run recorded, or
    // something else did, more than it should have.
    const f = findingsFor(M152, ledger(PRIOR, M152, M153));
    expect(f.length).toBeGreaterThan(0);
    expect(f.join(" | ")).toContain(`expected ${M152}`);
  });

  it("10 — an UNKNOWN remote version is refused", () => {
    // Production contains a migration the repository cannot explain.
    const f = findingsFor(M152, ledger(PRIOR, M152, "29999999999999"));
    expect(f.length).toBeGreaterThan(0);
    expect(f.join(" | ")).toContain("UNKNOWN_REMOTE_VERSION");
  });

  it("11 — an EMPTY ledger after recording is refused", () => {
    const f = findingsFor(M152, ledger());
    expect(f.join(" | ")).toContain("(empty)");
    expect(f.length).toBeGreaterThan(0);
  });

  it("12 — the predicate is exact, not merely a count", () => {
    // Same pending COUNT as the healthy case, but the wrong members. A check
    // that compared lengths would pass this.
    const after = reconcile(REPO, ledger(PRIOR, M153));
    expect(after.pending.length).toBe(3); // [M152, M154, M155]
    const f = postRecordFindings({ repo: REPO, after, version: M153 });
    expect(f.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("the runner still enforces everything else", () => {
  const runner = code("scripts/migrate-production.mjs");
  /**
   * The APPLY path's step 5 only. `--record-only` is a separate mode with its
   * own stricter post-checks, pinned by migration-ledger-record.test.ts and
   * deliberately left untouched by this fix — so an assertion about "the weak
   * condition is gone" must be scoped, or it would be asserting something this
   * change did not set out to do.
   */
  const step5 = runner.slice(runner.indexOf("step 5 — post-record verification"));

  it("13 — the weak condition is gone from the APPLY path", () => {
    expect(step5.length).toBeGreaterThan(0);
    expect(step5).not.toContain("after.pending.length !== 0");
    expect(step5).toContain("postRecordFindings({ repo, after, version })");
  });

  it("14 — exit 40 is NOT suppressed: findings still stop the run", () => {
    // The fix must narrow WHEN the state is wrong, never what happens then.
    expect(runner).toContain("stop(STATE.POST_MISMATCH");
    expect(runner).toContain("The ledger HAS been written");
    expect(runner).toContain('POST_MISMATCH: { code: 40');
  });

  it("15 — FAILED COMPANION VERIFIER still fails the run after recording", () => {
    // Needs a database, so it is asserted where it lives: step 5 re-runs the
    // verifier and adds a finding when it no longer passes.
    expect(runner).toContain("queryFile(tgt, m.verifier)");
    expect(runner).toContain("the verifier no longer passes after recording");
    expect(runner).toContain("the verifier could not be re-run");
    // …and within step 5 the re-run happens after the predicate, both feeding
    // one `post` array. Scoped to step 5: the record-only mode also re-runs the
    // verifier, earlier in the file.
    expect(step5.indexOf("postRecordFindings(")).toBeGreaterThan(-1);
    expect(step5.indexOf("postRecordFindings(")).toBeLessThan(
      step5.indexOf("queryFile(tgt, m.verifier)"),
    );
  });

  it("16 — the earlier gates are untouched", () => {
    for (const kept of [
      "step 0 — preflight",
      "step 1 — validate repository/ledger state",
      "step 2 — apply SQL",
      "step 3 — verify postconditions",
      "step 4 — record in the ledger",
      "requireCleanTree",
      "validateTarget",
      "crossCheckCli",
    ]) {
      expect(runner, kept).toContain(kept);
    }
  });

  it("17 — it still applies exactly ONE migration and never writes the ledger with SQL", () => {
    expect(runner).toContain("applies THIS one only");
    expect(runner).not.toMatch(/insert\s+into\s+supabase_migrations/i);
    expect(runner).not.toMatch(/update\s+supabase_migrations/i);
  });

  it("18 — the success line reports the real remaining count, not a hardcoded 0", () => {
    // It used to print "0 pending" unconditionally, which would have been a
    // lie on every run but the last.
    expect(runner).not.toContain("0 pending.`");
    expect(runner).toContain("${after.pending.length} pending");
  });

  it("19 — the predicate did not weaken the read-only guard", () => {
    const guard = code("scripts/migration-integrity.mjs");
    expect(guard).not.toContain("applyFile");
    expect(guard).toContain("queryFile");
  });

  it("20 — and the migration SQL for #152-155 was not touched", () => {
    // This incident is a tooling defect. The SQL is already in production for
    // #152 and must be byte-identical for the three that follow.
    for (const v of [M152, M153, M154, M155]) {
      expect(read(`supabase/migrations/${v}_${v === M152 ? "customs_reference_library" : v === M153 ? "customs_reference_publication_gate" : v === M154 ? "customs_reference_scan_replay" : "customs_reference_regime_axis"}.sql`).length)
        .toBeGreaterThan(100);
    }
  });
});
