/**
 * SUPABASE-LINK-PRIVILEGE-01-FIX — the production runner establishes its project
 * context WITHOUT the Management API, and that must stay true.
 * ---------------------------------------------------------------------------
 * THE INCIDENT. The first protected dry-run for #139 failed at
 * `supabase link --project-ref …` with a server-side authorization error. Every
 * governed step after it — integrity guard, dry run, apply, verify, record —
 * was skipped. `link` is not a context setter: on the pinned CLI it makes four
 * Management API calls, and the runner consumes the result of exactly one of
 * them (the pooler address). A permission on an endpoint the runner never reads
 * stopped a migration from even being validated.
 *
 * THE FIX is to remove the requirement rather than satisfy it: write the two
 * cache files the CLI reads, and call no Management API endpoint at all.
 * Measured against production on CLI 2.106.0 — `db query`, `migration list` and
 * the integrity guard each make ZERO requests to api.supabase.com, including on
 * a query that fails.
 *
 * WHAT THESE TESTS ARE FOR. The mechanism depends on a CLI cache directory that
 * is not a public interface, and on nobody "helpfully" restoring `supabase link`
 * the next time something looks unlinked. Both are held here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePoolerUrl, writeLinkContext, PROJECT_REF_RE } from "../scripts/migration/link-context.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/** Strip line comments so an assertion cannot be satisfied by prose ABOUT the rule. */
const js = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
const yml = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

const REF = "abcdefghijklmnopqrst";
const GOOD = `postgresql://postgres.${REF}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

// ===========================================================================
// §3/§10 — the secret contract, and every way it must refuse
// ===========================================================================

describe("the project context refuses anything it cannot vouch for", () => {
  it("01 — a valid pair is accepted", () => {
    expect(validatePoolerUrl(GOOD, REF)).toEqual([]);
  });

  // §13.1–13.5, and each is a separate refusal rather than one generic one:
  // an operator reading a red step needs to know WHICH input was wrong.
  it.each([
    ["§13.1 missing pooler URL", "", REF, /SUPABASE_POOLER_URL is empty/],
    ["§13.2 malformed URL", "not a url", REF, /not a parseable URL/],
    ["§13.2 wrong scheme", `mysql://postgres.${REF}@h:5432/x`, REF, /not a postgresql/],
    ["§13.3 embedded password", `postgresql://postgres.${REF}:s3cret@h:5432/postgres`, REF, /embedded password/],
    ["§13.4 missing project ref", GOOD, "", /SUPABASE_PROJECT_REF is empty/],
    ["§13.4 ref is not a ref", GOOD, "SHORT", /not a project ref/],
    ["§13.5 mismatched project", GOOD, "zzzzzzzzzzzzzzzzzzzz", /DIFFERENT project/],
    ["§13.5 no pooler role at all", "postgresql://@h:5432/postgres", REF, /no pooler role|no host/],
  ])("02 — %s is refused", (_label, url, ref, expected) => {
    const problems = validatePoolerUrl(url, ref);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toMatch(expected);
  });

  it("03 — a password is refused even when everything else is right", () => {
    // The single most damaging input: it would work. A pooler URL carrying a
    // password would smuggle a production database credential into a GitHub
    // secret and onto the runner's disk, turning a least-privilege fix into a
    // privilege escalation — and nothing downstream would complain, because the
    // connection would simply succeed.
    const withPw = `postgresql://postgres.${REF}:hunter2@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
    expect(validatePoolerUrl(withPw, REF).join(" ")).toMatch(/embedded password/);
  });

  it("04 — the host is deliberately NOT constrained", () => {
    // Pooler hostnames carry a region Supabase may change. A rule that guessed
    // at geography would fail closed on a legitimate move — an outage caused by
    // the safety check rather than by the thing it guards.
    const elsewhere = `postgresql://postgres.${REF}@aws-9-ap-southeast-2.pooler.supabase.com:6543/postgres`;
    expect(validatePoolerUrl(elsewhere, REF)).toEqual([]);
  });

  it("05 — a project ref is twenty lowercase letters, and nothing else", () => {
    expect(PROJECT_REF_RE.test(REF)).toBe(true);
    for (const bad of ["ABCDEFGHIJKLMNOPQRST", "abc", `${REF}x`, "abcdefghijklmnopqrs1"]) {
      expect(PROJECT_REF_RE.test(bad), bad).toBe(false);
    }
  });
});

// ===========================================================================
// §4 — the fail-closed cache contract
// ===========================================================================

describe("the CLI cache shape is pinned, so a change is a test failure", () => {
  it("06 — exactly two files, named and located as the pinned CLI reads them", () => {
    const root = mkdtempSync(join(tmpdir(), "eft-ctx-test-"));
    try {
      const dir = writeLinkContext(root, REF, GOOD);
      expect(dir.replace(/\\/g, "/")).toMatch(/\/supabase\/\.temp$/);
      // §13.6/13.7/13.8 — the shape itself. Extra files would mean we invented
      // state we never measured; missing ones mean the CLI cannot resolve.
      expect(readdirSync(dir).sort()).toEqual(["pooler-url", "project-ref"]);
      // Written EXACTLY: no trailing newline, no quoting, no BOM. This is the
      // representation the investigation measured against production.
      expect(readFileSync(join(dir, "project-ref"), "utf8")).toBe(REF);
      expect(readFileSync(join(dir, "pooler-url"), "utf8")).toBe(GOOD);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("07 — and a CI contract check proves the pinned CLI still honours it", () => {
    const ci = yml(".github/workflows/ci.yml");
    expect(ci).toContain("scripts/migration/verify-link-context.mjs");
    const probe = js("scripts/migration/verify-link-context.mjs");
    // The probe must have a CONTROL: without one, "no "Cannot find project ref""
    // could mean the CLI changed its wording rather than that it read the cache.
    expect(probe).toContain("cannot find project ref");
    expect(probe).toContain("INCONCLUSIVE");
    // It must never be able to touch a real project.
    expect(probe).toContain("zzzzzzzzzzzzzzzzzzzz");
    expect(probe).not.toMatch(/xtpppzhkiagdpmnghdlc/);
  });
});

// ===========================================================================
// §13.9/13.10 — the workflow may not drift back
// ===========================================================================

describe("the protected workflow does not link, and has no way back to the API", () => {
  const wf = () => yml(".github/workflows/migrate-production.yml");

  it("08 — §13.9: `supabase link` is gone from the production workflow", () => {
    expect(wf()).not.toMatch(/supabase\s+link/);
  });

  it("09 — it establishes context through the audited script instead", () => {
    const w = wf();
    expect(w).toContain("scripts/migration/link-context.mjs");
    expect(w).toContain("SUPABASE_POOLER_URL");
    expect(w).toContain("SUPABASE_PROJECT_REF");
  });

  it("10 — §13.10: there is no Management API fallback anywhere in the runner path", () => {
    // A fallback would hide exactly the failure this exists to surface: the run
    // would go green while quietly requiring the privilege we removed.
    for (const f of [
      "scripts/migration/link-context.mjs",
      "scripts/migration/exec.mjs",
      "scripts/migrate-production.mjs",
      "scripts/migration-integrity.mjs",
    ]) {
      expect(js(f), f).not.toMatch(/api\.supabase\.com/);
      expect(js(f), f).not.toMatch(/supabase\s+link\b/);
    }
  });

  it("11 — §13.11: no code path emits `--project-ref` to the pinned CLI", () => {
    // CLI 2.106.0 answers `UnrecognizedOption` for that flag on db query,
    // migration list, migration repair and migration up. A target that emits it
    // cannot execute a single command, however confident its label.
    const exec = js("scripts/migration/exec.mjs");
    expect(exec).not.toMatch(/"--project-ref"/);
    expect(exec).toContain('"--workdir"');
    // …and the repaired target refuses to be built from half its inputs.
    expect(exec).toContain("needs a poolerUrl");
  });

  it("12 — the governance controls the fix must not touch are all still there", () => {
    const w = wf();
    for (const pin of [
      "workflow_dispatch", "production-db", "cancel-in-progress: false",
      "group: migrate-production", "--dry-run", "default: true",
      "migration-integrity.mjs", "migrate-production.mjs",
    ]) {
      expect(w, pin).toContain(pin);
    }
    // One migration per invocation: still exactly one version input, no list.
    expect(w).toMatch(/version:\s*\n\s*description:/);
    expect(w).not.toMatch(/--batch|--all-pending|--skip/);
  });
});

// ===========================================================================
// §9 / §13.14–13.15 — a post-run integrity failure may not read as success
// ===========================================================================

describe("the post-run integrity report can no longer be swallowed", () => {
  const wf = () => read(".github/workflows/migrate-production.yml");

  it("13 — §13.15: the `|| true` that hid a failed report is gone", () => {
    // It reported SUCCESS on 2026-09-08 in a run where the project was never
    // linked and the report could not possibly have executed.
    expect(wf()).not.toMatch(/migration-integrity\.mjs\s+--linked\s*\|\|\s*true/);
  });

  it("14 — §13.14: it runs always, and its outcome is captured, not discarded", () => {
    const w = wf();
    expect(w).toContain("id: post_integrity");
    expect(w).toContain("continue-on-error: true");
  });

  it("15 — the summary reports the two results SEPARATELY", () => {
    const w = wf();
    expect(w).toContain("MIGRATION RESULT");
    expect(w).toContain("POST-RUN INTEGRITY RESULT");
    // The indeterminate state must be named where an operator will read it.
    expect(w).toMatch(/VERIFY_FAILED/);
    expect(w).toMatch(/SCHEMA_AHEAD_OF_LEDGER/);
  });

  it("16 — and a bad integrity reading fails the run", () => {
    const w = wf();
    expect(w).toContain("steps.post_integrity.outcome != 'success'");
    const gate = w.slice(w.indexOf("Integrity report must have actually run"));
    expect(gate).toContain("exit 1");
    expect(gate).toContain("::error");
  });
});
