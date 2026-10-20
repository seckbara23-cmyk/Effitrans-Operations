/**
 * MIG-LOCK-GUARD — the production apply takes a bounded lock wait.
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES. `lock_timeout` was unset on the production database
 * (`0`, source `default`), so the only bound on a DDL lock wait was
 * `statement_timeout` — 120 s, from the Supabase platform config. An
 * `ALTER TABLE` wants ACCESS EXCLUSIVE, and a request that is QUEUED blocks
 * every reader of that table behind it until it is granted or gives up. Two
 * minutes of that on a table the notification bell polls every 60 s is an
 * outage; three seconds is a retry.
 *
 * WHAT IS TESTED WHERE. These are the assertions that can be made from source:
 * the guard's text, that only the production runner passes it, that every other
 * caller is untouched, and that it is refused on a transport where it could not
 * work. The BEHAVIOUR — that `set local` governs the DDL, that a timeout rolls
 * the whole body back, that the ledger is never written — needs two concurrent
 * sessions and a real database, so it lives in
 * `scripts/migration-lock-guard-probe.mjs` and runs in CI against the
 * disposable Postgres. Neither half is sufficient alone.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPLY_GUARD, applyFile, target } from "../scripts/migration/exec.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const exec = read("scripts/migration/exec.mjs");
const runner = read("scripts/migrate-production.mjs");
const probe = read("scripts/migration-lock-guard-probe.mjs");
const ci = read(".github/workflows/ci.yml");

/** The platform's own statement_timeout, measured on production: 120000 ms. */
const PLATFORM_STATEMENT_TIMEOUT_MS = 120_000;

// ===========================================================================
describe("1 — the guard itself", () => {
  it("1.1 — bounds the lock wait at 3 seconds", () => {
    expect(APPLY_GUARD).toContain("set local lock_timeout = '3s'");
  });

  it("1.2 — PINS statement_timeout at the platform value and does not tighten it", () => {
    // Tightening would be the dangerous edit: this guard rides along with every
    // future migration through this path, and some will legitimately run longer
    // than a constraint widening. Restating 120 s only removes the dependency on
    // a platform default that could change.
    const m = /statement_timeout = '(\d+)(s|min|ms)'/.exec(APPLY_GUARD);
    expect(m, "the guard must pin statement_timeout explicitly").not.toBeNull();
    const [, n, unit] = m!;
    const ms = unit === "ms" ? Number(n) : unit === "s" ? Number(n) * 1000 : Number(n) * 60_000;
    expect(ms).toBe(PLATFORM_STATEMENT_TIMEOUT_MS);
  });

  it("1.3 — uses `set local`, which dies with the transaction", () => {
    // A plain `set` would outlive the apply on a pooled connection and silently
    // govern whatever reused it next.
    const statements = APPLY_GUARD.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const s of statements) expect(s.startsWith("set local ")).toBe(true);
  });

  it("1.4 — cannot glue onto the first line of the migration body", () => {
    // It is concatenated with the body, so it must end terminated AND newlined.
    expect(APPLY_GUARD.endsWith("\n")).toBe(true);
    expect(APPLY_GUARD.trimEnd().endsWith(";")).toBe(true);
    const glued = APPLY_GUARD + "alter table public.notification drop constraint x;";
    expect(glued).toContain("';\nalter table");
  });

  it("1.5 — sets nothing else", () => {
    // Scope creep here changes the semantics of every migration that follows.
    const settings = [...APPLY_GUARD.matchAll(/set local (\w+)/g)].map((m) => m[1]).sort();
    expect(settings).toEqual(["lock_timeout", "statement_timeout"]);
  });
});

// ===========================================================================
describe("2 — it is only applied where it can work", () => {
  it("2.1 — the pooler-direct transports accept a multi-statement body", () => {
    expect(target({ kind: "linked" }).multiStatement).toBe(true);
  });

  it("2.2 — `--db-url` does NOT, so the guard must not be prepended there", () => {
    // Over --db-url the CLI uses the extended query protocol, which answers
    // "cannot insert multiple commands into a prepared statement". Prepending
    // there would turn a working apply into a protocol error.
    expect(target({ kind: "db-url", url: "postgresql://u:p@127.0.0.1:54322/postgres" }).multiStatement).toBe(false);
  });

  it("2.3 — `--local` claims nothing, because nothing measured it", () => {
    expect(target({ kind: "local" }).multiStatement).toBe(false);
  });

  it("2.4 — applyFile checks the capability before prepending", () => {
    expect(exec).toContain("if (!tgt.multiStatement)");
  });
});

// ===========================================================================
describe("2b — a guard that cannot be enforced is REFUSED, never dropped", () => {
  // The dangerous outcome is not "no guard". It is a caller that believes a
  // timeout is in force while an ACCESS EXCLUSIVE request can queue every
  // reader of the table for the full 120 s statement_timeout. So neither layer
  // may apply unguarded when a guard was asked for.

  const dbUrl = { kind: "db-url" as const, url: "postgresql://u:p@127.0.0.1:54322/postgres" };

  it("2b.1 — applyFile REFUSES rather than applying unguarded", () => {
    // Functional, not structural: the refusal lands before the body is read or
    // any process is spawned, so this runs with no database and no CLI.
    const tgt = target(dbUrl);
    const r = applyFile(tgt, "supabase/migrations/20261020000001_notification_workflow_types.sql", {
      guard: APPLY_GUARD,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("refused");
    expect(r.message).toContain("Nothing was applied");
  });

  it("2b.2 — …and it refuses BEFORE touching the filesystem or spawning anything", () => {
    // A path that cannot be read: if the capability check ran late, this would
    // surface as ENOENT (or a CLI error) instead of the refusal.
    const r = applyFile(target(dbUrl), "no/such/migration-does-not-exist.sql", { guard: APPLY_GUARD });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("cannot take a multi-statement body");
    expect(r.message).not.toMatch(/ENOENT|no such file/i);
  });

  it("2b.3 — it does NOT warn-and-continue", () => {
    // The first draft of this change logged a warning and applied the body
    // anyway. That is the fail-open behaviour this test exists to prevent.
    expect(exec).not.toContain("Applying the body unguarded.");
    const guardBranch = exec.slice(exec.indexOf("if (!tgt.multiStatement)"));
    expect(guardBranch).toContain("ok: false");
    expect(guardBranch.slice(0, guardBranch.indexOf("}"))).not.toContain("return exec(file)");
  });

  it("2b.4 — the runner refuses the run in step 0, before any apply", () => {
    const step0 = runner.slice(runner.indexOf("step 0"), runner.indexOf("step 1 — validate"));
    expect(step0).toContain("!tgt.multiStatement");
    expect(step0).toContain("STATE.PREFLIGHT");
    expect(step0).toContain("cannot carry the apply guard");
  });

  it("2b.5 — the refusal covers the DRY RUN too", () => {
    // A dry run answers "would the real apply work?". Reporting "every
    // precondition passed" when one did not is exactly what it exists to stop.
    const step0 = runner.slice(runner.indexOf("step 0"), runner.indexOf("step 1 — validate"));
    expect(step0).not.toContain("args.dryRun");
    expect(runner.indexOf("cannot carry the apply guard")).toBeLessThan(runner.indexOf("if (args.dryRun)"));
  });

  it("2b.6 — record-only is exempt, because it applies no SQL", () => {
    expect(runner).toContain("!args.recordOnly && !tgt.multiStatement");
  });

  it("2b.7 — step 2 no longer pretends an unguarded apply is possible", () => {
    // With step 0 refusing, a "guard: NOT APPLIED" log line could only ever
    // contradict the refusal above it.
    expect(runner).not.toContain("guard: NOT APPLIED");
    expect(runner).toContain("applyFile(tgt, m.path, { guard: APPLY_GUARD })");
  });

  it("2b.8 — the capable transport is NOT refused", () => {
    // The refusal must be about the transport, not about guards in general.
    expect(target({ kind: "linked" }).multiStatement).toBe(true);
    const step0 = runner.slice(runner.indexOf("step 0"), runner.indexOf("step 1 — validate"));
    expect(step0).toContain("if (!args.recordOnly && !tgt.multiStatement) {");
  });
});

// ===========================================================================
describe("3 — every other caller is untouched", () => {
  it("3.1 — with no guard, applyFile takes the original path", () => {
    expect(exec).toContain("if (!guard) return exec(file);");
  });

  it("3.2 — only the production runner passes a guard", () => {
    // The rehearsal, the security probe and the atomicity measurement all call
    // applyFile; none of them may acquire a timeout they did not ask for.
    for (const f of [
      "scripts/migration-rehearsal.mjs",
      "scripts/verifier-security-probe.mjs",
      "scripts/measure-atomicity.mjs",
    ]) {
      expect(read(f), f).not.toContain("guard:");
    }
  });

  it("3.3 — the guard is defined once, in exec.mjs, and imported", () => {
    // migrate-production.mjs calls main() at module scope, so the constant
    // cannot live there: importing it to borrow the value would launch the
    // production runner. The probe depends on that.
    expect(exec).toContain("export const APPLY_GUARD");
    expect(runner).not.toContain("const APPLY_GUARD =");
    expect(runner).toContain("APPLY_GUARD } from \"./migration/exec.mjs\"");
    expect(probe).toContain('from "./migration/exec.mjs"');
    expect(probe).not.toContain('from "./migrate-production.mjs"');
  });

  it("3.4 — applyFile still returns {ok,message} and never throws on SQL failure", () => {
    // The caller decides what a failure means, because the answer depends on
    // whether the ledger was written. That contract must survive the refactor.
    expect(exec).toContain("return { ok: false, message:");
    expect(exec).toContain('return { ok: true, message: "" };');
  });

  it("3.5 — the 900 s CLI process timeout is preserved", () => {
    expect(exec).toContain("timeoutMs: 900_000");
  });
});

// ===========================================================================
describe("4 — the apply site and its failure path", () => {
  it("4.1 — step 2 passes the guard", () => {
    expect(runner).toContain("applyFile(tgt, m.path, { guard: APPLY_GUARD })");
  });

  it("4.2 — a lock timeout is explained as a safe, re-runnable outcome", () => {
    // An operator who meets this at 02:00 needs to know nothing was applied.
    expect(runner).toContain("55P03");
    expect(runner).toMatch(/NOTHING was applied/);
    expect(runner).toMatch(/re-runnable/);
  });

  it("4.3 — the ledger is still NOT written on an apply failure", () => {
    const step2 = runner.slice(runner.indexOf("step 2 — apply SQL"), runner.indexOf("step 3 — verify"));
    expect(step2).toContain("STATE.NOT_APPLIED");
    expect(step2).toContain("the ledger was NOT written");
  });

  it("4.4 — `set local` is only sound because non-db-query executors are refused", () => {
    // Under psql-no-transaction there is no surrounding transaction, so the
    // setting would warn and protect nothing. Step 0's refusal is what makes
    // the guard correct; this pins the two together.
    expect(runner).toContain('executor !== "db-query"');
    expect(runner).toContain("does not apply automatically");
  });
});

// ===========================================================================
describe("5 — the behavioural probe is wired up and scoped", () => {
  it("5.1 — CI runs it against the disposable database", () => {
    expect(ci).toContain("scripts/migration-lock-guard-probe.mjs");
    expect(ci).toContain("--db-url");
  });

  it("5.2 — it refuses any target that is not local", () => {
    // It provokes failing SQL and takes ACCESS EXCLUSIVE locks.
    expect(probe).toContain("is not a local target");
    expect(probe).toContain("127");
    expect(probe).toContain("localhost");
  });

  it("5.3 — it covers all five required behaviours", () => {
    for (const scenario of [
      "a guarded body applies normally",
      "the prepended `set local` governs the body",
      "under contention the guard fails in ~3s",
      "the SAME contention, unguarded, waits it out",
      "a late failure rolls back the drop that had succeeded",
      "ledger safety",
    ]) {
      expect(probe, scenario).toContain(scenario);
    }
  });

  it("5.4 — it works in its own scratch schema and drops it", () => {
    expect(probe).toContain("eft_lockguard_probe");
    expect(probe).toContain("drop schema if exists");
  });

  it("5.5 — it tests the REAL constant, not a transcription of it", () => {
    expect(probe).toContain("APPLY_GUARD");
    expect(probe).not.toMatch(/const\s+(APPLY_)?GUARD\s*=\s*["'`]set local/);
  });
});

// ===========================================================================
describe("6 — migration #156 is not touched", () => {
  it("6.1 — the notification-type migration is byte-identical to the released one", () => {
    // This change is about HOW a migration is applied. Editing the migration
    // would invalidate the CI run that already proved it.
    const mig = read("supabase/migrations/20261020000001_notification_workflow_types.sql");
    expect(mig).toContain("alter table public.notification");
    expect(mig).not.toContain("lock_timeout");
    expect(mig).not.toContain("statement_timeout");
    expect(mig).not.toContain("set local");
  });

  it("6.2 — no migration carries its own timeout, now or later", () => {
    // The guard belongs to the apply path. A migration that sets its own would
    // be invisible to this test suite and to the runner's log.
    const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(files.length, "guard must not be vacuous").toBeGreaterThan(150);
    const offenders = files.filter((f) => {
      const bare = readFileSync(dir + f, "utf8").replace(/--.*$/gm, "");
      return /set\s+(local\s+)?(lock_timeout|statement_timeout)/i.test(bare);
    });
    expect(offenders).toEqual([]);
  });
});
