/**
 * UAT-RECEVABILITE-01 — the ledger's source vocabulary, enforced structurally.
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED. Production's `record_customs_receivability` passed
 * `p_source => 'rpc'` to `emit_business_event`. `business_event_source_check`
 * has never admitted a bare 'rpc', so every call raised 23514 inside the
 * definer function, aborted its transaction and rolled back the decision it
 * had just written. The Déclarant saw « Enregistrement impossible. »
 * Recevabilité had never once been recorded in production.
 *
 * WHAT THIS FILE CAN AND CANNOT DO, STATED PLAINLY. It reads the REPOSITORY,
 * and the repository was correct the whole time — 20260824000001 has said
 * 'policy_rpc' in both of the only commits that ever touched it. So these
 * tests would NOT have caught that incident. Nothing that reads files could
 * have: the divergence existed only in the live function body, and the thing
 * that catches it is the companion verifier, which reads pg_get_functiondef.
 *
 * What they DO buy is the other direction, cheaply: a future call site that
 * invents a source the ledger does not admit now fails here, in milliseconds,
 * instead of silently in production months later. That asymmetry is the honest
 * description of this file's value, and it is worth having.
 *
 * THE ALLOWED SET IS DERIVED, NEVER RESTATED. A hard-coded duplicate of the
 * lane list would be a second source of truth that drifts from the constraint
 * it claims to mirror — and the whole incident is about two definitions of one
 * thing disagreeing. So the list is extracted from the latest migration that
 * defines the constraint, and the extraction itself is asserted non-empty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const dir = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => readFileSync(dir(p), "utf8");
/** Code only: `--` comments are prose and must never satisfy or break a pin. */
const code = (s: string) => s.replace(/^[^\S\n]*--.*$/gm, "").replace(/--[^\n]*/g, "");

const MIGRATION_DIR = "supabase/migrations";
const MIGRATIONS = readdirSync(dir(MIGRATION_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const PARITY = `${MIGRATION_DIR}/20261013000001_receivability_source_parity.sql`;
const ORIGIN = `${MIGRATION_DIR}/20260824000001_customs_receivability.sql`;
const VERIFIER = "supabase/verifiers/20261013000001_receivability_source_parity.verify.sql";

/**
 * The lanes `business_event.source` admits, read from the LAST migration that
 * defines the constraint. Later migrations widened it (three lanes became
 * seven), so only the most recent definition is authoritative.
 */
function allowedSources(): string[] {
  const defining = MIGRATIONS.filter((f) =>
    /add\s+constraint\s+business_event_source_check/i.test(read(`${MIGRATION_DIR}/${f}`)),
  );
  expect(defining.length, "no migration defines business_event_source_check").toBeGreaterThan(0);
  const last = defining[defining.length - 1];
  const sql = code(read(`${MIGRATION_DIR}/${last}`));
  const clause = /add\s+constraint\s+business_event_source_check\s*check\s*\(\s*source\s+in\s*\(([\s\S]*?)\)\s*\)/i
    .exec(sql);
  expect(clause, `could not read the source list out of ${last}`).not.toBeNull();
  const lanes = [...clause![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  // If the extraction ever silently returns nothing, every call-site assertion
  // below would vacuously pass. Refuse that.
  expect(lanes.length, `extracted no lanes from ${last}`).toBeGreaterThan(2);
  return lanes;
}

/** Split one argument list on TOP-LEVEL commas, respecting nesting and quotes. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quoted) {
      cur += ch;
      if (ch === "'") quoted = args[i + 1] === "'";
      continue;
    }
    if (ch === "'") { quoted = true; cur += ch; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Every `emit_business_event(...)` call site in the migrations, with its source. */
function callSites(): { file: string; source: string | null; raw: string }[] {
  const sites: { file: string; source: string | null; raw: string }[] = [];
  for (const file of MIGRATIONS) {
    const sql = code(read(`${MIGRATION_DIR}/${file}`));
    const re = /emit_business_event\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      // Walk to the matching close paren so a nested jsonb_build_object cannot
      // end the argument list early.
      let depth = 1;
      let quoted = false;
      let i = m.index + m[0].length;
      for (; i < sql.length && depth > 0; i += 1) {
        const ch = sql[i];
        if (quoted) { if (ch === "'") quoted = sql[i + 1] === "'"; continue; }
        if (ch === "'") { quoted = true; continue; }
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
      }
      const raw = sql.slice(m.index + m[0].length, i - 1);
      const named = /p_source\s*=>\s*'([a-z_]+)'/i.exec(raw);
      if (named) {
        sites.push({ file, source: named[1], raw });
        continue;
      }
      // Positional: emit_business_event(tenant, event_type, event_domain, source, …)
      const parts = splitArgs(raw);
      const fourth = parts[3] ?? "";
      const lit = /^'([a-z_]+)'$/.exec(fourth);
      sites.push({ file, source: lit ? lit[1] : null, raw });
    }
  }
  return sites;
}

describe("UAT-RECEVABILITE-01 — source contract", () => {
  it("01 — the allowed lanes are derived from the constraint, not restated here", () => {
    const lanes = allowedSources();
    // The two the incident turned on: the correct lane must be admitted and the
    // bare one must not. Asserted ABOUT the derived list, so the derivation
    // itself is what is being trusted.
    expect(lanes).toContain("policy_rpc");
    expect(lanes).not.toContain("rpc");
  });

  it("02 — every emit_business_event call site uses an admitted source", () => {
    const lanes = allowedSources();
    const sites = callSites();
    expect(sites.length, "no emit_business_event call sites found").toBeGreaterThan(5);
    const bad = sites
      .filter((s) => s.source !== null && !lanes.includes(s.source))
      .map((s) => `${s.file}: '${s.source}'`);
    expect(bad, `call sites declaring a source the ledger refuses:\n${bad.join("\n")}`).toEqual([]);
  });

  it("03 — and no call site passes the bare 'rpc' that broke production", () => {
    const offenders = callSites()
      .filter((s) => s.source === "rpc")
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe("UAT-RECEVABILITE-01 — migration 151 restores parity without inventing", () => {
  it("04 — it reuses the authoritative body BYTE-FOR-BYTE", () => {
    // The strongest form of "do not invent a new implementation": the function
    // definition and its privilege block are the same characters in both
    // files. A hand-retyped near-copy fails here.
    const slice = (src: string) => {
      const start = src.indexOf("create or replace function public.record_customs_receivability(");
      expect(start, "function not found").toBeGreaterThan(-1);
      const end = src.indexOf("to service_role;", start);
      expect(end, "grant block not found").toBeGreaterThan(start);
      return src.slice(start, end + "to service_role;".length);
    };
    expect(slice(read(PARITY))).toBe(slice(read(ORIGIN)));
  });

  it("05 — the restored body emits policy_rpc and never the bare lane", () => {
    const sql = code(read(PARITY));
    expect(sql).toMatch(/p_source\s*=>\s*'policy_rpc'/);
    expect(sql).not.toMatch(/p_source\s*=>\s*'rpc'/);
  });

  it("06 — it restores the actor-authority assertion production was missing", () => {
    expect(code(read(PARITY))).toMatch(
      /assert_actor_authority\s*\(\s*p_actor\s*,\s*v_tenant\s*,\s*'customs:update'\s*,\s*'SERVICE'\s*\)/,
    );
  });

  it("07 — it does NOT widen the constraint to accommodate the defect", () => {
    const sql = code(read(PARITY));
    // READING the constraint is correct and wanted — the migration refuses to
    // run if someone has widened it to admit 'rpc'. ALTERING it is forbidden.
    expect(sql).toMatch(/business_event_source_check/);
    expect(sql).not.toMatch(/alter\s+table\s+public\.business_event/i);
    expect(sql).not.toMatch(/(add|drop)\s+constraint\s+business_event_source_check/i);
  });

  it("08 — the MIGRATION writes no data, though the function it installs may", () => {
    // The distinction this test exists to draw: `update public.customs_record`
    // inside the function BODY is the function doing its job at runtime. The
    // same statement at migration top level would be a data write. So the body
    // is excised and the remainder is what gets audited.
    const sql = code(read(PARITY));
    const start = sql.indexOf("create or replace function public.record_customs_receivability(");
    const endMark = "end; $$;";
    const end = sql.indexOf(endMark, start);
    expect(start, "function not found").toBeGreaterThan(-1);
    expect(end, "function terminator not found").toBeGreaterThan(start);
    const outsideBody = sql.slice(0, start) + sql.slice(end + endMark.length);

    for (const forbidden of [
      /\binsert\s+into\b/i,
      /\bdelete\s+from\b/i,
      /\bupdate\s+public\./i,
      /\btruncate\b/i,
    ]) {
      expect(
        outsideBody,
        `migration 151 must not contain ${forbidden} outside the function body`,
      ).not.toMatch(forbidden);
    }
    // And the body must be the only place customs_record is written at all.
    expect(sql.match(/update\s+public\.customs_record/gi)?.length ?? 0).toBe(1);

    // The dossier that surfaced the bug must not appear anywhere: this is a
    // platform repair, not a recovery.
    expect(sql).not.toContain("3021c009");
    expect(sql).not.toContain("EFT-IMP-2026-00014");
  });

  it("09 — the already-applied migration it repairs is untouched", () => {
    // 20260824000001 is applied and immutable. It must still be the correct
    // definition — editing it would "fix" a CI run that is already green and
    // would never reach production.
    const origin = code(read(ORIGIN));
    expect(origin).toMatch(/p_source\s*=>\s*'policy_rpc'/);
    expect(origin).not.toMatch(/p_source\s*=>\s*'rpc'/);
  });
});

describe("UAT-RECEVABILITE-01 — the verifier is the check that would have caught it", () => {
  const v = read(VERIFIER);

  it("10 — it reads the LIVE function body, not a file", () => {
    expect(v).toContain("pg_get_functiondef");
    // A verifier that read the repository would pass on the day production broke.
    expect(v).not.toMatch(/readFileSync|supabase\/migrations/);
  });

  it("11 — it strips comments before matching, and anchors on the QUOTED literal", () => {
    // 'policy_rpc' contains the substring `rpc`; a bare like '%rpc%' would
    // report a healthy database as broken.
    expect(v).toContain("regexp_replace(def, '--[^\\n]*', '', 'g')");
    expect(v).toMatch(/p_source\\s\*=>\\s\*''rpc''/);
    // The forbidden pattern must be absent from the verifier's CODE. Its prose
    // quotes `like '%rpc%'` precisely to explain why it is wrong — and the
    // first draft of this assertion matched that comment and failed, which is
    // the same trap, one layer up. Strip comments, then look.
    expect(code(v)).not.toMatch(/like\s*'%rpc%'/);
  });

  it("12 — it pins the signature, the definer flag and the execute privileges", () => {
    expect(v).toContain("record_customs_receivability(uuid,text,text,uuid)");
    expect(v).toContain("prosecdef");
    expect(v).toContain("has_function_privilege('service_role'");
    expect(v).toContain("has_function_privilege('anon'");
    expect(v).toContain("has_function_privilege('authenticated'");
  });

  it("13 — it proves the constraint was not widened", () => {
    expect(v).toContain("business_event_source_check");
    expect(v).toMatch(/not\s*\(\s*'rpc'\s*=\s*any/);
  });

  it("14 — it is read-only and never consults the migration ledger", () => {
    // STATEMENT-SHAPED, not word-shaped. The verifier legitimately contains the
    // word `update` twice — in `for update` and in the permission string
    // 'customs:update' — so a bare \bupdate\b assertion fails on a read-only
    // file. What must be absent is a statement that mutates.
    expect(code(v)).not.toMatch(/(^|;)\s*(insert|update|delete|alter|drop|create|grant|revoke)\s/i);
    // Comment-stripped again: the header names `supabase_migrations` in order to
    // record that it is deliberately never read (the #140/#141 lesson).
    expect(code(v)).not.toContain("supabase_migrations");
    // Verifiers return one row; a `do $$` block returns none.
    expect(code(v)).not.toMatch(/do\s*\$\$/);
  });
});

describe("UAT-RECEVABILITE-01 — ledger", () => {
  it("15 — the migration ledger constants match the committed files", () => {
    expect(MIGRATION_COUNT).toBe(MIGRATIONS.length);
    expect(LATEST_MIGRATION).toBe("20261013000001_receivability_source_parity");
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(`${LATEST_MIGRATION}.sql`);
  });

  it("16 — migration 151 declares an executor this toolchain can apply", () => {
    expect(read(PARITY)).toMatch(/^--\s*migrate:executor\s+db-query/m);
  });
});
