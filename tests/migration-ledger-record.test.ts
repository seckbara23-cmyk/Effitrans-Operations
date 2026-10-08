/**
 * MIG-LEDGER-151 — the record-only path, and the splitter it depends on.
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG. Production workflow #18 applied 20261013000001, its
 * verifier passed 13/13, and `supabase migration repair --linked` printed
 * nothing but "Initialising login role... Connecting to remote database..."
 * and wrote no row. The pooler transport was demonstrably fine — it had just
 * applied the SQL and run the verifier through it. The supported recording
 * mechanism simply did not record, with no error text, and the runner
 * correctly refused to re-apply: a live schema the ledger denies, and no
 * governed way to finish.
 *
 * WHY THESE TESTS LOOK LIKE THIS. The scenarios that matter — a successful
 * record, a duplicate, a partial failure — are database outcomes, and there is
 * no local Postgres in this environment. So `ledger-record.mjs` takes its query
 * function as an injectable option, and the tests drive it with fakes. That is
 * not a workaround: it makes the DECISION logic testable in isolation, which is
 * where #18's bug lived. The CLI's real behaviour is covered by the one thing a
 * fake cannot give — `proveFormat`, which re-checks the encoding against rows
 * the CLI itself wrote, every time the recovery runs.
 *
 * The splitter's correctness is proven against production separately and
 * reported in the PR: 150/150 recorded migrations reproduce, 131 byte-identical
 * and 19 identical once the ledger's historical CRLF is normalised.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";
import {
  splitStatements,
  fingerprint,
  safeTag,
  recordOne,
  proveFormat,
  isRecorded,
} from "../scripts/migration/ledger-record.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const RUNNER = read("scripts/migrate-production.mjs");
const EXEC = read("scripts/migration/exec.mjs");
const WORKFLOW = read(".github/workflows/migrate-production.yml");

describe("MIG-LEDGER-151 — the splitter must not shred dollar-quoted SQL", () => {
  it("01 — keeps a dollar-quoted body whole, semicolons and all", () => {
    const sql = "select 1;\ndo $x$ begin perform 1; perform 2; end $x$;\nselect 2;";
    expect(splitStatements(sql)).toEqual([
      "select 1",
      "do $x$ begin perform 1; perform 2; end $x$",
      "select 2",
    ]);
  });

  it("02 — handles the bare $$ tag as well as a named one", () => {
    const out = splitStatements("do $$ begin perform 1; end $$;");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("perform 1;");
  });

  it("03 — a semicolon inside a string literal is not a separator", () => {
    expect(splitStatements("select 'a;b';select 2;")).toEqual(["select 'a;b'", "select 2"]);
  });

  it("04 — doubled quotes inside a literal do not end it", () => {
    expect(splitStatements("select 'it''s; fine';")).toEqual(["select 'it''s; fine'"]);
  });

  it("05 — a semicolon inside a quoted identifier is not a separator", () => {
    expect(splitStatements('select 1 as "a;b";')).toEqual(['select 1 as "a;b"']);
  });

  it("06 — a semicolon inside a line comment is not a separator", () => {
    expect(splitStatements("select 1 -- ; not a split\n;")).toEqual(["select 1 -- ; not a split"]);
  });

  it("07 — block comments nest, as they do in Postgres", () => {
    expect(splitStatements("/* a /* b ; */ c ; */ select 1;")).toEqual([
      "/* a /* b ; */ c ; */ select 1",
    ]);
  });

  it("08 — comments are RETAINED, because the ledger retains them", () => {
    const out = splitStatements("-- header\nselect 1;");
    expect(out[0]).toBe("-- header\nselect 1");
  });

  it("09 — each statement is trimmed, and blank trailing text yields nothing", () => {
    expect(splitStatements("select 1;\n\n  select 2;\n\n")).toEqual(["select 1", "select 2"]);
  });

  it("10 — CRLF is normalised, so a Windows checkout hashes like CI's", () => {
    expect(splitStatements("select 1;\r\nselect 2;\r\n")).toEqual(["select 1", "select 2"]);
    expect(fingerprint(splitStatements("select 1;\r\n")).md5)
      .toBe(fingerprint(splitStatements("select 1;\n")).md5);
  });

  it("11 — an unterminated final statement still counts", () => {
    expect(splitStatements("select 1;\nselect 2")).toEqual(["select 1", "select 2"]);
  });

  it("12 — the real #151 migration splits without losing its function body", () => {
    const out = splitStatements(read("supabase/migrations/20261013000001_receivability_source_parity.sql"));
    const fn = out.find((s) => s.includes("create or replace function public.record_customs_receivability"));
    expect(fn, "the function must be one whole statement").toBeTruthy();
    // Its body contains semicolons; if the splitter had cut them the statement
    // would be truncated before `end; $$`.
    expect(fn!).toContain("p_source        => 'policy_rpc'");
    expect(fn!).toContain("assert_actor_authority");
    // And the privilege statements are their own, not swallowed into the
    // function. NOT anchored with `^`: a statement carries the comment block
    // that precedes it, so the first revoke begins with `-- OPS-SEC-1:`.
    expect(out.filter((s) => /revoke execute on function public\.record_customs_receivability/i.test(s)))
      .toHaveLength(3);
    expect(out.filter((s) => /grant {2}execute on function public\.record_customs_receivability/i.test(s)))
      .toHaveLength(1);
  });

  it("13 — the fingerprint separator is never NUL, which Postgres rejects", () => {
    // chr(0) raised `54000 null character not permitted` and broke the first
    // draft of the proof. Comments are stripped before looking, because the
    // module explains that mistake in prose — and the first draft of THIS
    // assertion matched the explanation, which is the same trap one layer up.
    const code = read("scripts/migration/ledger-record.mjs")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[^\S\n]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/chr\(0\)/);
    expect(code).not.toContain("\\u0000");
    expect(code).toContain("chr(1)");
  });
});

describe("MIG-LEDGER-151 — recordOne fails closed", () => {
  const stmts = ["select 1"];
  const never = () => {
    throw new Error("the database must not be touched in this case");
  };

  it("14 — refuses a malformed version before touching the database", () => {
    for (const version of ["2026101300000", "abc", "", "20261013000001x"]) {
      const r = recordOne(null, { version, name: "x", statements: stmts }, { q: never });
      expect(r.ok, `version '${version}' must be refused`).toBe(false);
      expect(r.inserted).toBe(false);
    }
  });

  it("15 — refuses a malformed or missing name", () => {
    for (const name of ["", null, "has space", "semi;colon", "quo'te"]) {
      const r = recordOne(null, { version: "20261013000001", name, statements: stmts }, { q: never });
      expect(r.ok, `name '${name}' must be refused`).toBe(false);
    }
  });

  it("16 — refuses an empty statements array", () => {
    const r = recordOne(null, { version: "20261013000001", name: "x", statements: [] }, { q: never });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/empty statements/);
  });

  it("17 — SUCCESS: reports ok only when the row reads back matching", () => {
    const want = fingerprint(stmts);
    const r = recordOne(
      null,
      { version: "20261013000001", name: "receivability_source_parity", statements: stmts },
      { q: () => [{ rows: 1, name: "receivability_source_parity", cardinality: want.cardinality, md5: want.md5 }] },
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("20261013000001");
  });

  it("18 — DUPLICATE: a second run is a no-op, not a second row", () => {
    const want = fingerprint(stmts);
    // `where not exists` means the insert does nothing; the read-back still
    // finds exactly one matching row, so the operation reports success.
    const sqlSeen: string[] = [];
    const r = recordOne(
      null,
      { version: "20261013000001", name: "n", statements: stmts },
      {
        q: (_t: unknown, sql: string) => {
          sqlSeen.push(sql);
          return [{ rows: 1, name: "n", cardinality: want.cardinality, md5: want.md5 }];
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(sqlSeen[0]).toContain("where not exists");
  });

  it("19 — refuses when the read-back finds anything other than one row", () => {
    for (const rows of [0, 2]) {
      const r = recordOne(
        null,
        { version: "20261013000001", name: "n", statements: stmts },
        { q: () => [{ rows, name: "n", cardinality: 1, md5: "x" }] },
      );
      expect(r.ok, `${rows} rows must be refused`).toBe(false);
      expect(r.detail).toContain(`${rows} row(s)`);
    }
  });

  it("20 — refuses when the stored content does not match what was sent", () => {
    const r = recordOne(
      null,
      { version: "20261013000001", name: "n", statements: stmts },
      { q: () => [{ rows: 1, name: "n", cardinality: 1, md5: "deadbeefdeadbeef" }] },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/does not match what was sent/);
  });

  it("21 — refuses when the stored name is wrong", () => {
    const want = fingerprint(stmts);
    const r = recordOne(
      null,
      { version: "20261013000001", name: "wanted", statements: stmts },
      { q: () => [{ rows: 1, name: "other", cardinality: want.cardinality, md5: want.md5 }] },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/recorded name is 'other'/);
  });

  it("22 — PARTIAL FAILURE: a throwing insert reports not-inserted, never ok", () => {
    const r = recordOne(
      null,
      { version: "20261013000001", name: "n", statements: stmts },
      { q: () => { throw new Error("connection reset mid-statement"); } },
    );
    expect(r.ok).toBe(false);
    expect(r.inserted).toBe(false);
    expect(r.detail).toMatch(/connection reset/);
  });

  it("23 — the dollar-quote tag is chosen to be absent from the content", () => {
    const tag = safeTag(["$lrec0$ appears here", "and $lrec1$ too"]);
    expect(tag).toBe("$lrec2$");
    // A statement containing the chosen tag would corrupt the literal, so the
    // content is what picks the tag, not a constant.
    const r = recordOne(
      null,
      { version: "20261013000001", name: "n", statements: ["select '$lrec0$'"] },
      { q: (_t: unknown, sql: string) => {
          expect(sql).not.toContain("$lrec0$select");
          const f = fingerprint(["select '$lrec0$'"]);
          return [{ rows: 1, name: "n", cardinality: f.cardinality, md5: f.md5 }];
        } },
    );
    expect(r.ok).toBe(true);
  });

  it("24 — there is no UPDATE or DELETE against the ledger anywhere", () => {
    const src = read("scripts/migration/ledger-record.mjs");
    expect(src).not.toMatch(/update\s+\$\{LEDGER\}|delete\s+from\s+\$\{LEDGER\}/i);
    expect(src).not.toMatch(/\btruncate\b/i);
    // Exactly one insert, and it is the guarded one.
    expect(src.match(/insert into \$\{LEDGER\}/g) ?? []).toHaveLength(1);
  });
});

describe("MIG-LEDGER-151 — proveFormat is a precondition, not a claim", () => {
  const mig = (version: string, path: string, recorded: boolean) => ({ version, path, recorded });
  const real = "supabase/migrations/20261013000001_receivability_source_parity.sql";

  it("25 — refuses when there is nothing recorded to prove against", () => {
    const r = proveFormat(null, [mig("20261013000001", real, false)], { q: () => [] });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no recorded migration/);
  });

  it("26 — passes when the ledger agrees once CRLF is normalised", () => {
    const f = fingerprint(splitStatements(read(real)));
    const r = proveFormat(
      null,
      [mig("20261013000001", real, true)],
      { q: () => [{ version: "20261013000001", name: "n", cardinality: f.cardinality, md5: "whatever", md5_lf: f.md5 }] },
    );
    expect(r.ok).toBe(true);
    // Reported honestly: this one matched only after normalisation.
    expect(r.exact).toBe(0);
    expect(r.detail).toMatch(/CRLF is normalised/);
  });

  it("27 — a cardinality difference is absolute and cannot be normalised away", () => {
    const f = fingerprint(splitStatements(read(real)));
    const r = proveFormat(
      null,
      [mig("20261013000001", real, true)],
      { q: () => [{ version: "20261013000001", name: "n", cardinality: f.cardinality + 1, md5: f.md5, md5_lf: f.md5 }] },
    );
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toMatch(/elements locally vs/);
  });

  it("28 — content differing beyond line endings fails", () => {
    const f = fingerprint(splitStatements(read(real)));
    const r = proveFormat(
      null,
      [mig("20261013000001", real, true)],
      { q: () => [{ version: "20261013000001", name: "n", cardinality: f.cardinality, md5: "a", md5_lf: "b" }] },
    );
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toMatch(/beyond line endings/);
  });

  it("29 — isRecorded strips anything non-numeric from the version", () => {
    let seen = "";
    isRecorded(null, "20261013000001'; drop table x; --", { q: (_t: unknown, sql: string) => { seen = sql; return [{ n: 0 }]; } });
    expect(seen).toContain("'20261013000001'");
    expect(seen).not.toMatch(/drop table/i);
  });
});

describe("MIG-LEDGER-151 — the runner's record-only mode", () => {
  it("30 — refuses to record a migration whose verifier does not pass", () => {
    // Recording an unapplied migration is the September 2026 gap in reverse:
    // the ledger would claim an apply that never happened.
    expect(RUNNER).toMatch(/if \(args\.recordOnly\) \{/);
    expect(RUNNER).toMatch(/--record-only refuses: .*verifier does NOT pass/);
  });

  it("31 — it never applies SQL", () => {
    const start = RUNNER.indexOf("if (args.recordOnly) {");
    const end = RUNNER.indexOf("if (pre && pre.ok === true) {", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = RUNNER.slice(start, end);
    expect(branch).not.toContain("applyFile");
    expect(branch).toContain("proveFormat");
    expect(branch).toContain("recordOne");
  });

  it("32 — it proves the encoding BEFORE recording", () => {
    const branch = RUNNER.slice(RUNNER.indexOf("if (args.recordOnly) {"));
    expect(branch.indexOf("proveFormat")).toBeLessThan(branch.indexOf("recordOne("));
  });

  it("33 — it verifies ledger count, pending, integrity and the verifier afterwards", () => {
    const branch = RUNNER.slice(RUNNER.indexOf("if (args.recordOnly) {"));
    expect(branch).toContain("after.ledgerCount !== after.repoCount");
    expect(branch).toContain("after.pending.length !== 0");
    expect(branch).toContain("LEDGER_STATUS.CLEAN");
    expect(branch).toContain("no longer passes after recording");
    expect(branch).toContain("STATE.POST_MISMATCH");
  });

  it("34 — WRONG TARGET: a target is never defaulted, so it must be stated", () => {
    // `target()` throws without an explicit spec, and the runner refuses
    // without one; there is no implicit production.
    expect(EXEC).toContain("[exec] a target is required");
    expect(RUNNER).toMatch(/if \(!args\.target \|\| !args\.version\)/);
  });

  it("35 — MISSING MIGRATION: preflight refuses an unknown or uncommitted version", () => {
    expect(RUNNER).toContain("no committed migration file for version");
    expect(RUNNER).toContain("is not committed");
    expect(RUNNER).toContain("missing companion verifier");
  });

  it("36 — the stale SCHEMA_AHEAD advice now points at the governed path", () => {
    expect(RUNNER).toContain("record_only: true");
    expect(RUNNER).toContain("--record-only");
  });
});

describe("MIG-LEDGER-151 — repair() decides from state, not prose", () => {
  it("37 — it no longer matches the CLI's success wording", () => {
    const start = EXEC.indexOf("export function repair(");
    const body = EXEC.slice(start, EXEC.indexOf("\n}", start));
    expect(body).not.toMatch(/Migration history repaired/);
    expect(body).not.toMatch(/unexpected repair output/);
  });

  it("38 — it reads the ledger back and compares against the requested status", () => {
    const start = EXEC.indexOf("export function repair(");
    const body = EXEC.slice(start, EXEC.indexOf("\n}", start));
    expect(body).toContain("supabase_migrations.schema_migrations");
    expect(body).toContain("present === want");
  });

  it("39 — an unreadable ledger is an unknown effect, never a success", () => {
    const start = EXEC.indexOf("export function repair(");
    const body = EXEC.slice(start, EXEC.indexOf("\n}", start));
    expect(body).toMatch(/could not be read back/);
  });
});

describe("MIG-LEDGER-151 — the workflow keeps the same protection", () => {
  it("40 — record_only is an input, defaulting to off", () => {
    expect(WORKFLOW).toMatch(/record_only:\s*\n\s*description:/);
    expect(WORKFLOW).toMatch(/record_only:[\s\S]{0,200}?default: false/);
  });

  it("41 — the record step runs the runner with --record-only and nothing else", () => {
    expect(WORKFLOW).toMatch(/--version "\$\{\{ inputs\.version \}\}" --record-only/);
  });

  it("42 — apply and dry-run are excluded when record_only is set", () => {
    expect(WORKFLOW).toContain("if: ${{ !inputs.dry_run && !inputs.record_only }}");
    expect(WORKFLOW).toContain("if: ${{ inputs.dry_run && !inputs.record_only }}");
    expect(WORKFLOW).toContain("if: ${{ inputs.record_only }}");
  });

  it("43 — it is still gated on the production-db environment", () => {
    expect(WORKFLOW).toMatch(/environment:\s*\n\s*name: production-db/);
  });

  it("44 — the summary names the mode, so RECORD ONLY cannot be mistaken for an apply", () => {
    expect(WORKFLOW).toContain("RECORD ONLY (no SQL applied)");
    expect(WORKFLOW).toContain("steps.record_step.outcome");
  });

  it("45 — no migration was added to repair migration history", () => {
    // The ledger is metadata about migrations. Repairing it WITH a migration
    // would put the repair inside the thing being repaired — and #152 would
    // itself need recording, by the mechanism that just failed.
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".verify.sql"))
      .sort();
    expect(files).toHaveLength(151);
    expect(files[files.length - 1]).toBe("20261013000001_receivability_source_parity.sql");
    expect(MIGRATION_COUNT).toBe(151);
    expect(LATEST_MIGRATION).toBe("20261013000001_receivability_source_parity");
  });
});
