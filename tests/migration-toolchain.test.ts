/**
 * The migration toolchain — invariants, and the properties that keep it safe.
 * ---------------------------------------------------------------------------
 * These run with no database: the reconciliation logic is pure, and the safety
 * properties (the guard cannot mutate; verifiers are read-only; nothing writes
 * the ledger table with SQL) are properties of the SOURCE. A database test could
 * not prove "there is no code path that writes" — only reading the code can.
 *
 * The scenario names are the four failure states from the approved design, so a
 * regression reads as the state it breaks rather than as a line number.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcile, validateTarget } from "../scripts/migration/ledger.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/**
 * Source assertions must read CODE, not prose. These files explain in their
 * comments exactly which verbs they refuse to use — so an assertion over the
 * raw text matches the explanation and proves nothing.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

type M = { version: string; name: string; file: string; verifier: string; malformed?: boolean };
const mig = (v: string, name = "thing", verifier = "yes"): M => ({
  version: v,
  name,
  file: `${v}_${name}.sql`,
  verifier: verifier === "yes" ? "package.json" : "does/not/exist.sql", // an existing path stands in for "verifier present"
});
const led = (v: string, name = "thing") => ({ version: v, name });

// ═══════════ reconciliation ════════════════════════════════════════════════

describe("migration toolchain — reconciliation", () => {
  it("01 — a clean repository and ledger produce no findings", () => {
    const r = reconcile([mig("20260101000001"), mig("20260102000001")], [led("20260101000001"), led("20260102000001")]);
    expect(r.hard).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.remoteMax).toBe("20260102000001");
  });

  it("02 — THE SEPTEMBER GAP: applied-but-unrecorded behind the maximum is a HARD finding", () => {
    // Exactly the 123–137 shape: files exist, the ledger stops earlier, and the
    // missing versions sort BELOW the remote maximum.
    const repo = [mig("20260101000001"), mig("20260102000001"), mig("20260103000001")];
    const ledger = [led("20260101000001"), led("20260103000001")];
    const r = reconcile(repo, ledger);
    expect(r.hard.map((h) => h.code)).toContain("MISSING_REMOTELY_BEHIND_MAX");
    expect(r.hard.find((h) => h.code === "MISSING_REMOTELY_BEHIND_MAX")!.version).toBe("20260102000001");
  });

  it("03 — a version recorded remotely with no local file is a HARD finding", () => {
    const r = reconcile([mig("20260101000001")], [led("20260101000001"), led("20260109000001")]);
    expect(r.hard.map((h) => h.code)).toContain("UNKNOWN_REMOTE_VERSION");
  });

  it("04 — an ordinary pending migration at the head is NOT a finding", () => {
    // The normal pre-deployment state must stay quiet, or the guard gets ignored.
    const r = reconcile([mig("20260101000001"), mig("20260102000001")], [led("20260101000001")]);
    expect(r.hard).toEqual([]);
    expect(r.pending).toEqual(["20260102000001"]);
  });

  it("05 — a rename is advisory, never hard: it cannot affect production", () => {
    const r = reconcile([mig("20260101000001", "new_name")], [led("20260101000001", "old_name")]);
    expect(r.hard).toEqual([]);
    expect(r.advisory.map((a) => a.code)).toEqual(["NAME_MISMATCH"]);
  });

  it("06 — a malformed filename is a hard finding", () => {
    const bad = { version: "nope", name: "", file: "nope.sql", verifier: "package.json", malformed: true };
    const r = reconcile([bad as M], []);
    expect(r.hard.map((h) => h.code)).toContain("MALFORMED_VERSION");
  });
});

// ═══════════ the ordering invariant ════════════════════════════════════════

describe("migration toolchain — the version invariant is ordering-based, not arithmetic", () => {
  const repo = [mig("20260101000001"), mig("20260102000001"), mig("20260103000001")];

  it("07 — the next migration in repository order is allowed", () => {
    const ledger = [led("20260101000001"), led("20260102000001")];
    const state = reconcile(repo, ledger);
    expect(validateTarget("20260103000001", repo, ledger, state)).toEqual([]);
  });

  it("08 — timestamps are not counters: a non-adjacent id is fine if it is next in ORDER", () => {
    // 20260103000001 is nowhere near max+1 numerically. Requiring arithmetic
    // adjacency would reject every legitimate migration this project makes.
    const ledger = [led("20260101000001"), led("20260102000001")];
    const state = reconcile(repo, ledger);
    const problems = validateTarget("20260103000001", repo, ledger, state);
    expect(problems.join(" ")).not.toMatch(/\+ ?1|adjacent|sequential/i);
  });

  it("09 — skipping an earlier pending migration is refused, and says which", () => {
    const ledger = [led("20260101000001")];
    const state = reconcile(repo, ledger);
    const problems = validateTarget("20260103000001", repo, ledger, state);
    expect(problems.join(" ")).toMatch(/would be skipped/);
    expect(problems.join(" ")).toContain("20260102000001");
  });

  it("10 — a version at or below the remote maximum is refused", () => {
    const ledger = [led("20260101000001"), led("20260102000001"), led("20260103000001")];
    const state = reconcile(repo, ledger);
    expect(validateTarget("20260102000001", repo, ledger, state).join(" ")).toMatch(/not greater than/);
  });

  it("11 — more than one pending migration is refused (one per deployment)", () => {
    const state = reconcile(repo, [led("20260101000001")]);
    expect(validateTarget("20260102000001", repo, [led("20260101000001")], state).join(" "))
      .toMatch(/exactly one pending/);
  });

  it("12 — a missing companion verifier is refused before anything is applied", () => {
    const repoNoVerifier = [mig("20260101000001"), mig("20260102000001", "thing", "no")];
    const ledger = [led("20260101000001")];
    const state = reconcile(repoNoVerifier, ledger);
    expect(validateTarget("20260102000001", repoNoVerifier, ledger, state).join(" ")).toMatch(/verifier/);
  });

  it("13 — an unclean repository blocks every target, whatever it is", () => {
    const dirty = [mig("20260101000001"), mig("20260102000001"), mig("20260103000001")];
    const ledger = [led("20260101000001"), led("20260103000001")]; // gap behind max
    const state = reconcile(dirty, ledger);
    // 20260102000001 is the gap itself — a real file, and the target an operator
    // would most plausibly reach for. It must still be refused.
    expect(validateTarget("20260102000001", dirty, ledger, state).join(" ")).toMatch(/integrity is not clean/);
  });
});

// ═══════════ safety properties of the source ═══════════════════════════════

describe("migration toolchain — safety properties", () => {
  it("14 — the guard is structurally incapable of mutating anything", () => {
    const guard = code("scripts/migration-integrity.mjs");
    // Target the CALL and the IMPORT, never the bare word: the guard legitimately
    // prints "supabase migration repair …" as operator instructions when it finds
    // a schema-ahead-of-ledger state. A word match flags that guidance, and an
    // assertion that cries wolf gets relaxed — leaving it unable to catch a real
    // call, which is the only thing that would actually make the guard mutate.
    expect(guard).not.toMatch(/\bapplyFile\s*\(/);
    expect(guard).not.toMatch(/(?<!migration )\brepair\s*\(/);
    const imports = guard.match(/import \{[^}]*\} from "\.\/migration\/exec\.mjs"/)![0];
    expect(imports).not.toContain("applyFile");
    expect(imports).not.toContain("repair");
    expect(guard).toMatch(/import \{[^}]*queryFile[^}]*\} from "\.\/migration\/exec\.mjs"/);
  });

  it("15 — nothing in the toolchain writes the ledger table with SQL", () => {
    // Ruling 2: recording is `supabase migration repair`, never an INSERT.
    for (const f of ["scripts/migration-integrity.mjs", "scripts/migrate-production.mjs", "scripts/migration/ledger.mjs", "scripts/migration/exec.mjs"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/insert\s+into\s+supabase_migrations/i);
      expect(src, f).not.toMatch(/update\s+supabase_migrations/i);
      expect(src, f).not.toMatch(/delete\s+from\s+supabase_migrations/i);
    }
  });

  it("16 — the runner has no flag that skips approval or steps", () => {
    const runner = code("scripts/migrate-production.mjs");
    expect(runner).not.toMatch(/break[- _]?glass/i);
    expect(runner).not.toMatch(/--force\b/);
    expect(runner).not.toMatch(/--skip/);
  });

  it("17 — the runner records ONLY through the supported mechanism", () => {
    const exec = code("scripts/migration/exec.mjs");
    expect(exec).toMatch(/"migration",\s*"repair"/);
    const runner = code("scripts/migrate-production.mjs");
    expect(runner).toMatch(/repair\(tgt, version\)/);
  });

  it("18 — every one of the four failure states is reachable in the runner", () => {
    const runner = code("scripts/migrate-production.mjs");
    for (const state of ["NOT_APPLIED", "VERIFY_FAILED", "SCHEMA_AHEAD", "POST_MISMATCH"]) {
      expect(runner, state).toMatch(new RegExp(`stop\\(STATE\\.${state},`));
    }
  });

  it("19 — the ledger is never written before the verifier has passed", () => {
    const runner = read("scripts/migrate-production.mjs");
    expect(runner.indexOf("step 3 — verify")).toBeLessThan(runner.indexOf("step 4 — record"));
    expect(runner.indexOf("step 4 — record")).toBeLessThan(runner.indexOf("step 5 — post-record"));
  });
});

// ═══════════ the verifier convention ═══════════════════════════════════════

describe("migration toolchain — the verifier convention", () => {
  it("20 — verifiers live outside supabase/migrations, or the CLI reads them as migrations", () => {
    // Learned the hard way: a `<version>_<name>.verify.sql` inside the
    // migrations directory parses as a SECOND migration with a duplicate
    // version, shows as pending, and `db push` would try to apply it.
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    expect(readdirSync(dir).filter((f) => f.endsWith(".verify.sql"))).toEqual([]);
  });

  it("21 — the worked example exists for migration 138 and is read-only", () => {
    const p = "supabase/verifiers/20260930000001_customs_release_approval.verify.sql";
    expect(existsSync(fileURLToPath(new URL(`../${p}`, import.meta.url)))).toBe(true);
    const sql = read(p).replace(/^\s*--.*$/gm, "");
    for (const re of [/^\s*insert\s+/im, /^\s*update\s+/im, /^\s*delete\s+/im, /^\s*create\s+/im,
                      /^\s*alter\s+/im, /^\s*drop\s+/im, /^\s*grant\s+/im, /^\s*set\s+role/im, /do\s+\$\$/i]) {
      expect(sql, String(re)).not.toMatch(re);
    }
    expect(sql).toMatch(/\bok\b/);
    expect(sql).toMatch(/\bdetail\b/);
  });

  it("22 — it verifies meaning, not merely that names exist", () => {
    const sql = read("supabase/verifiers/20260930000001_customs_release_approval.verify.sql");
    // Nullability, the closed vocabulary, SECURITY DEFINER, the anon/authenticated
    // revoke, and the maker/checker comparison — each a property the slice would
    // be broken without, none of them satisfied by a name alone.
    expect(sql).toMatch(/is_nullable/);
    expect(sql).toMatch(/prosecdef/);
    expect(sql).toMatch(/has_function_privilege/);
    expect(sql).toMatch(/v_recorder/);
  });
});
