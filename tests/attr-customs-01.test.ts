/**
 * ATTR-CUSTOMS-01 — `reviewed_by` is the step 7 validator, and nothing else.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as UAT found it on EFT-IMP-2026-00011. The Chef de Transit
 * validated step 7. The field agent recorded the BAE, the Chef approved the
 * release, the field agent finalised it — and `record_customs_release` wrote
 * `reviewed_by = p_actor`, so the dossier read « Validé par agterrain ». The
 * WES-9 customs trigger read `reviewed_by` as the actor of EVERY status and BAE
 * event, so BAE_RECORDED named the Chef, who never recorded it.
 *
 * These are the repository-side proofs: which column each act writes, which
 * column the ledger reads each actor from, that nothing else may write the
 * validator, and that the one-dossier production correction is tightly bound
 * and fails closed. The behavioural proof — the real RPCs, the real trigger,
 * and the correction script run UNMODIFIED under both the pre- and post-ATTR
 * trigger — is supabase/tests/attr_customs_01_attribution_test.sql (CI). The
 * end-to-end proof is the C-4 transit-customs journey.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";
import { getStep } from "@/lib/process/effitrans-process";

const path = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => readFileSync(path(p), "utf8");
/** SQL with line comments removed: prose may name a column, code may not. */
const sql = (s: string) => s.replace(/--[^\n]*/g, "");
/** TypeScript with comments removed. */
const ts = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20261005000001_customs_actor_attribution.sql";
const VERIFIER = "supabase/verifiers/20261005000001_customs_actor_attribution.verify.sql";
const CORRECTION = "supabase/data-corrections/attr_customs_01_eft_imp_2026_00011.sql";
const PREFLIGHT = "supabase/data-corrections/attr_customs_01_eft_imp_2026_00011.preflight.sql";
const SUITE = "supabase/tests/attr_customs_01_attribution_test.sql";
const PRE_ATTR_TRIGGER = "supabase/migrations/20260727000001_business_event_atomicity.sql";
const PRE_ATTR_RELEASE = "supabase/migrations/20260727000003_document_governance.sql";

const migrationFiles = readdirSync(path("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const contents = new Map(migrationFiles.map((f) => [f, read(`supabase/migrations/${f}`)]));

/**
 * The body of a function definition starting at `start`: from the header to the
 * close of its dollar-quoted body, whatever the tag.
 */
function bodyFrom(source: string, start: number): string {
  const open = /as\s+(\$[a-z_]*\$)/gi;
  open.lastIndex = start;
  const m = open.exec(source);
  if (!m) return "";
  const close = source.indexOf(m[1], m.index + m[0].length);
  return close < 0 ? "" : source.slice(start, close + m[1].length);
}

/** `create or replace function public.<name>(` in one source, or "". */
function fnIn(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : bodyFrom(source, start);
}

/** The LATEST definition of every public function across the migration chain. */
function latestDefinitions(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const f of migrationFiles) {
    const src = contents.get(f)!;
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const body = bodyFrom(src, m.index);
      if (body) out.set(m[1].toLowerCase(), { file: f, body });
    }
  }
  return out;
}

/** event type → the actor expression the customs trigger passes for it. */
function triggerActors(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /emit_business_event\(\s*new\.tenant_id,\s*'([A-Z_]+)',\s*'customs',\s*'db_trigger',\s*'customs_record',\s*new\.id,\s*new\.file_id,\s*([^,]+?)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

/** The metadata keys one customs trigger emission carries. */
function metadataKeys(body: string, eventType: string): string[] {
  const at = body.indexOf(`'${eventType}'`);
  const seg = body.slice(at, body.indexOf("));", at));
  return [...seg.matchAll(/'([a-z_]+)'\s*,\s*(?:old|new)\./g)].map((m) => m[1]).sort();
}

const tsFn = (source: string, name: string) => {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(path(dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}

// ===========================================================================
describe("root cause, pinned where it lived", () => {
  it("the pre-ATTR release wrote the validator column, and the pre-ATTR trigger read it for every act", () => {
    const oldRelease = sql(fnIn(read(PRE_ATTR_RELEASE), "record_customs_release"));
    expect(oldRelease).toMatch(/reviewed_by\s*=\s*p_actor/);

    const oldActors = triggerActors(sql(fnIn(read(PRE_ATTR_TRIGGER), "emit_customs_events")));
    expect(oldActors).toEqual({
      CUSTOMS_RECORD_CREATED: "new.created_by",
      CUSTOMS_STATUS_CHANGED: "new.reviewed_by",
      CUSTOMS_DECLARED: "new.reviewed_by",
      CUSTOMS_RELEASE_COMPLETED: "new.reviewed_by",
      BAE_RECORDED: "new.reviewed_by",
    });
  });
});

// ===========================================================================
describe("the release no longer writes the step 7 validator", () => {
  const latest = latestDefinitions().get("record_customs_release")!;
  const body = sql(latest.body);

  it("its live definition is the ATTR-CUSTOMS-01 one", () => {
    expect(latest.file).toBe("20261005000001_customs_actor_attribution.sql");
  });

  it("touches no reviewed_by, and attributes the release to its own column", () => {
    expect(body).not.toMatch(/reviewed_by/);
    expect(body).toMatch(/released_by\s*=\s*p_actor/);
  });

  it("refuses an unattributed release", () => {
    expect(body).toMatch(/if\s+p_actor\s+is\s+null\s+then\s+raise\s+exception\s+'an actor is required/);
  });

  it("keeps the release itself exactly as it was", () => {
    expect(body).toMatch(/p_customs_id\s+uuid,\s*p_bae_reference\s+text,\s*p_actor\s+uuid,\s*p_release_date\s+date\s+default\s+null,\s*p_policy_id\s+uuid\s+default\s+null/);
    expect(body).toMatch(/status\s*=\s*'RELEASED'/);
    expect(body).toMatch(/bae_reference\s*=\s*btrim\(p_bae_reference\)/);
    expect(body).toMatch(/release_date\s*=\s*coalesce\(p_release_date,\s*current_date\)/);
    expect(body).toContain("customs release is already recorded");
    expect(body).toMatch(/v_status\s+in\s+\('CANCELLED'\)/);
    expect(body).toMatch(/security\s+definer/);
    expect(body).toMatch(/set\s+search_path\s*=\s*public,\s*pg_temp/);
    // One fact, one event: the trigger emits the release, the RPC does not.
    expect(body).not.toMatch(/emit_business_event/);
  });

  it("stays service_role only", () => {
    const m = sql(read(MIGRATION));
    for (const role of ["public", "anon", "authenticated"]) {
      expect(m).toContain(`revoke execute on function public.record_customs_release(uuid, text, uuid, date, uuid) from ${role};`);
    }
    expect(m).toContain("grant  execute on function public.record_customs_release(uuid, text, uuid, date, uuid) to service_role;");
  });
});

// ===========================================================================
describe("the ledger reads each actor from the act's own column", () => {
  const latest = latestDefinitions().get("emit_customs_events")!;
  const body = sql(latest.body);
  const oldBody = sql(fnIn(read(PRE_ATTR_TRIGGER), "emit_customs_events"));

  it("its live definition is the ATTR-CUSTOMS-01 one, and reads no reviewed_by", () => {
    expect(latest.file).toBe("20261005000001_customs_actor_attribution.sql");
    expect(body).not.toMatch(/reviewed_by/);
  });

  it("maps every emission to the right actor", () => {
    expect(triggerActors(body)).toEqual({
      CUSTOMS_RECORD_CREATED: "new.created_by",
      CUSTOMS_STATUS_CHANGED: "v_release_actor",
      CUSTOMS_DECLARED: "null::uuid",
      CUSTOMS_RELEASE_COMPLETED: "v_release_actor",
      BAE_RECORDED: "v_bae_actor",
    });
  });

  it("derives the finaliser only from THIS release, and the recorder only from THIS recording", () => {
    expect(body).toMatch(
      /v_release_actor\s*:=\s*case\s+when\s+new\.status\s*=\s*'RELEASED'\s+and\s+old\.released_by\s+is\s+null\s+then\s+new\.released_by\s+end\s*;/,
    );
    expect(body).toMatch(
      /v_bae_actor\s*:=\s*case\s+when\s+new\.bae_recorded_at\s+is\s+distinct\s+from\s+old\.bae_recorded_at\s+then\s+new\.bae_recorded_by\s+end\s*;/,
    );
  });

  it("the extraction is not vacuous: re-introducing reviewed_by would be caught", () => {
    const regressed = body.replace("v_bae_actor,", "new.reviewed_by,");
    expect(triggerActors(regressed).BAE_RECORDED).toBe("new.reviewed_by");
    expect(regressed).toMatch(/reviewed_by/);
  });

  it("emits on exactly the same transitions, with the same metadata, as before", () => {
    for (const guard of [
      /new\.status is distinct from old\.status/,
      /new\.status = 'DECLARED'/,
      /new\.status = 'RELEASED'/,
      /new\.bae_reference is not null and old\.bae_reference is null/,
      /tg_op = 'INSERT'/,
    ]) {
      expect(oldBody).toMatch(guard);
      expect(body).toMatch(guard);
    }
    expect(Object.keys(triggerActors(body)).sort()).toEqual(Object.keys(triggerActors(oldBody)).sort());
    for (const type of ["CUSTOMS_STATUS_CHANGED", "CUSTOMS_DECLARED", "CUSTOMS_RELEASE_COMPLETED", "BAE_RECORDED", "CUSTOMS_RECORD_CREATED"]) {
      expect(metadataKeys(body, type), type).toEqual(metadataKeys(oldBody, type));
    }
    // A reviewed_by-only UPDATE therefore still emits nothing — no guard names it.
    expect(body).not.toMatch(/new\.reviewed_by\s+is\s+distinct/);
  });

  it("keeps WES-9A atomicity: a failed event rolls the customs write back", () => {
    expect(body).toMatch(/when\s+sqlstate\s+'EF001'\s+then\s+raise\s*;/);
    expect(body).toMatch(/using\s+errcode\s*=\s*'EF001'/);
    expect(body.slice(body.indexOf("exception"))).not.toMatch(/return\s+null\s*;/);
  });
});

// ===========================================================================
describe("the invariant, across the whole migration chain", () => {
  const defs = latestDefinitions();
  const writers = [...defs.entries()]
    .filter(([, d]) => /update\s+public\.customs_record\s+set[^;]*reviewed_by\s*=/i.test(sql(d.body)))
    .map(([name]) => name)
    .sort();

  it("only the validation door, its recertification and the correction write customs reviewed_by", () => {
    expect(writers).toEqual(["record_customs_correction", "record_customs_revalidation", "record_customs_validation"]);
  });

  it("the step 7 validation still writes it, under customs:validate", () => {
    const v = sql(defs.get("record_customs_validation")!.body);
    expect(v).toMatch(/reviewed_by\s*=\s*p_actor/);
    expect(v).toMatch(/assert_actor_authority\(p_actor,\s*v_tenant,\s*'customs:validate'/);
  });

  it("the release finaliser has exactly one writer", () => {
    const finalisers = [...defs.entries()]
      .filter(([, d]) => /update\s+public\.customs_record\s+set[^;]*released_by\s*=/i.test(sql(d.body)))
      .map(([name]) => name);
    expect(finalisers).toEqual(["record_customs_release"]);
  });

  it("maker/checker on the BAE is untouched", () => {
    const bae = sql(defs.get("record_customs_bae")!.body);
    const approval = sql(defs.get("record_customs_release_approval")!.body);
    expect(bae).toMatch(/bae_recorded_by\s*=\s*p_actor/);
    expect(approval).toMatch(/v_recorder\s*=\s*p_actor/);
    expect(approval).toContain("self_approval_forbidden");
    expect(approval).toMatch(/release_approval_by\s*=\s*p_actor/);
  });

  it("no application code writes customs reviewed_by either", () => {
    for (const file of [...walk("lib"), ...walk("app")]) {
      const src = ts(read(file));
      expect(src, file).not.toMatch(/\.from\("customs_record"\)\s*\.update\(\s*\{[^}]*reviewed_by/);
    }
    expect(tsFn(ts(read("lib/customs/actions.ts")), "changeCustomsStatus")).not.toMatch(/reviewed_by/);
  });
});

// ===========================================================================
describe("migration #143 ships under the #139+ policy", () => {
  const raw = read(MIGRATION);
  const code = sql(raw);

  it("adds released_by additively and backfills nothing", () => {
    expect(code).toMatch(/add column if not exists released_by uuid references public\.app_user \(id\)/);
    // The column DEFINITION carries neither NOT NULL nor a default — nothing
    // can populate it behind an operator.
    const definition = code.match(/add column if not exists released_by[^;]*;/)?.[0] ?? "";
    expect(definition).not.toBe("");
    expect(definition).not.toMatch(/not null|default/);
    // The only customs_record UPDATE in the file is inside the release function.
    const updates = code.match(/update\s+public\.customs_record/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(sql(fnIn(raw, "record_customs_release"))).toMatch(/update\s+public\.customs_record/);
    expect(code).not.toMatch(/insert\s+into\s+public\.(business_event|audit_log|customs_record)/);
  });

  it("its self-assertions read function bodies with comments STRIPPED", () => {
    expect(raw).toContain("regexp_replace(p.prosrc, '--[^\\n]*', '', 'g')");
    expect(code).toContain("record_customs_release still touches reviewed_by");
    expect(code).toContain("the customs trigger still derives an actor from reviewed_by");
    expect(code).toContain("customs reviewed_by has an unauthorised writer");
  });

  it("has a read-only verifier in supabase/verifiers, checking meaning", () => {
    expect(existsSync(path(VERIFIER))).toBe(true);
    expect(readdirSync(path("supabase/migrations")).some((f) => f.endsWith(".verify.sql"))).toBe(false);
    const v = read(VERIFIER).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    for (const re of [
      /^\s*(insert|update|delete|truncate|alter|drop|grant|revoke|create)\s+/im,
      /^\s*(set|reset)\s+(role|session)/im,
      /\bdo\s+\$\$/i,
      /\bsupabase_migrations\b/i,
    ]) {
      expect(v).not.toMatch(re);
    }
    expect(v).toMatch(/bool_and\(ok\)\s+as\s+ok/);
    expect(v).toMatch(/\bdetail\b/);
    for (const label of [
      "record_customs_release does NOT touch reviewed_by",
      "the customs trigger derives NO actor from reviewed_by",
      "customs reviewed_by has no writer outside validation / revalidation / correction",
      "BAE_RECORDED is attributed from bae_recorded_by, only when this update stamped it",
      "the release approval still names its approver and refuses the recorder",
    ]) {
      expect(v).toContain(label);
    }
  });

  it("build-info tracks it as the newest migration", () => {
    expect(LATEST_MIGRATION).toBe("20261005000001_customs_actor_attribution");
    expect(MIGRATION_COUNT).toBe(migrationFiles.length);
    expect(migrationFiles.at(-1)).toBe(`${LATEST_MIGRATION}.sql`);
  });
});

// ===========================================================================
describe("the production correction for EFT-IMP-2026-00011", () => {
  const raw = read(CORRECTION);
  const code = sql(raw);

  it("is not a migration, and is one atomic statement", () => {
    expect(CORRECTION.startsWith("supabase/migrations")).toBe(false);
    expect(CORRECTION.split("/").at(-1)).not.toMatch(/^\d{14}_/);
    expect(code.trim().startsWith("do $attr$")).toBe(true);
    expect(code.trim().endsWith("$attr$;")).toBe(true);
    expect(code.match(/\$attr\$/g)).toHaveLength(2);
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("targets exactly one dossier, record and tenant", () => {
    expect(code).toContain("c_tenant     constant uuid := '00000000-0000-0000-0000-000000000001'");
    expect(code).toContain("c_file       constant uuid := '7f8e6fb8-aafd-4932-b87a-b34cdca177f3'");
    expect(code).toContain("c_file_no    constant text := 'EFT-IMP-2026-00011'");
    expect(code).toContain("c_customs    constant uuid := '91d80919-8aaa-43cb-a5d3-24002b72850b'");
    expect(code).toContain("c_validator  constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167'");
    expect(code).toContain("c_overwriter constant uuid := '38ff054a-2a14-4f65-bb5a-1902050bc48f'");
  });

  it("re-derives the validator from BOTH immutable sources and refuses any disagreement", () => {
    expect(code).toMatch(/event_type = 'CUSTOMS_VALIDATED'/);
    expect(code).toMatch(/if v_n <> 1 then\s+raise exception 'ATTR-CUSTOMS-01 refused: expected exactly one CUSTOMS_VALIDATED/);
    expect(code).toMatch(/if v_event_actor is distinct from c_validator then\s+raise exception/);
    expect(code).toMatch(/if v_event_at is distinct from v_rec\.reviewed_at then\s+raise exception/);
    expect(code).toMatch(/from public\.audit_log[\s\S]*?action = 'customs\.updated' and actor_id = c_validator[\s\S]*?after ->> 'reviewed_by' = c_validator::text/);
    // A governed correction or recertification makes the value a human question.
    expect(code).toMatch(/event_type in \('CUSTOMS_CORRECTED', 'CUSTOMS_REVALIDATED'\)/);
    expect(code).toMatch(/from public\.customs_correction where customs_id = c_customs/);
    // Identity is never inferred from an e-mail address.
    expect(code).not.toContain("@");
    expect(code).not.toMatch(/\bemail\b/);
  });

  it("requires the defect to be present exactly as diagnosed", () => {
    expect(code).toMatch(/if v_rec\.reviewed_by is distinct from c_overwriter then\s+raise exception/);
    expect(code).toMatch(/v_rec\.status is distinct from 'RELEASED'/);
    expect(code).toMatch(/v_rec\.release_approval_status is distinct from 'APPROVED' or v_rec\.release_approval_by is distinct from c_validator/);
    expect(code).toMatch(/v_rec\.bae_recorded_by is distinct from c_overwriter/);
    expect(code).toMatch(/event_type = 'CUSTOMS_RELEASE_COMPLETED'[\s\S]*?v_release_actor is distinct from c_overwriter/);
  });

  it("writes ONE column on ONE row, and checks it hit exactly one", () => {
    const updates = code.match(/update\s+public\.[a-z_]+/g) ?? [];
    expect(updates).toEqual(["update public.customs_record"]);
    expect(code).toMatch(
      /update public\.customs_record\s+set reviewed_by = c_validator\s+where id\s+= c_customs\s+and tenant_id\s+= c_tenant\s+and file_id\s+= c_file\s+and deleted_at is null\s+and reviewed_by = c_overwriter\s+and reviewed_at = v_event_at\s+and status\s+= 'RELEASED';/,
    );
    expect(code).toMatch(/get diagnostics v_n = row_count;/);
    expect(code).toMatch(/if v_n <> 1 then\s+raise exception 'ATTR-CUSTOMS-01 refused: the correction matched/);
    expect(code).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });

  it("cannot manufacture a business event, and proves it did not", () => {
    expect(code).not.toMatch(/emit_business_event|insert\s+into\s+public\.business_event/);
    expect(code).toMatch(/select count\(\*\) into v_events_before from public\.business_event;/);
    expect(code).toMatch(/if v_events_after <> v_events_before then\s+raise exception 'ATTR-CUSTOMS-01 aborted: the correction appended/);
    // The EVENT trigger is never suspended: the proof runs through it.
    expect(code).not.toMatch(/disable trigger (trg_emit_customs_events|all|user)/i);
    expect(code).not.toMatch(/session_replication_role/);
  });

  it("changes nothing else on the record — updated_at included — and restores the trigger it suspends", () => {
    expect(code).toMatch(/if \(v_after - 'reviewed_by'\) is distinct from \(v_before - 'reviewed_by'\) then\s+raise exception/);
    expect(code.match(/disable trigger/g)).toHaveLength(1);
    expect(code.match(/enable trigger/g)).toHaveLength(1);
    const disable = code.indexOf("alter table public.customs_record disable trigger trg_customs_updated_at;");
    const update = code.indexOf("update public.customs_record");
    const enable = code.indexOf("alter table public.customs_record enable trigger trg_customs_updated_at;");
    expect(disable).toBeGreaterThan(0);
    expect(disable).toBeLessThan(update);
    expect(update).toBeLessThan(enable);
    expect(code).toMatch(/not tgisinternal and tgenabled <> 'O'/);
  });

  it("touches no process, dossier, ownership or transport state", () => {
    expect(code).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.(process_|operational_file|transport_|task|file_assignment|document)/i);
  });

  it("leaves exactly one trace, borrowing no identity", () => {
    const inserts = code.match(/insert\s+into\s+public\.[a-z_]+/g) ?? [];
    expect(inserts).toEqual(["insert into public.audit_log"]);
    expect(code).toMatch(/c_tenant, null, 'customs\.attribution_corrected', 'customs_record', c_customs/);
    expect(code).toMatch(/if v_n <> v_audit_before \+ 1 then\s+raise exception/);
  });

  it("has a strictly read-only preflight", () => {
    const p = sql(read(PREFLIGHT));
    expect(p).not.toMatch(/^\s*(insert|update|delete|truncate|alter|drop|grant|revoke|create|do)\b/im);
    expect(p).not.toMatch(/\bset\s+(role|session)\b/i);
    expect(p.trim().startsWith("with target as")).toBe(true);
    for (const field of ["affected_row_prediction", "derived_validator", "validation_instant_matches_record", "ledger_head", "defect_census"]) {
      expect(p).toContain(`'${field}'`);
    }
  });
});

// ===========================================================================
describe("the real-database proofs are wired", () => {
  const suite = read(SUITE);
  const ci = read(".github/workflows/ci.yml");

  it("runs the correction unmodified, under the pre-ATTR trigger and the new one, then proves a rerun is refused", () => {
    expect(suite.match(/\\ir \.\.\/data-corrections\/attr_customs_01_eft_imp_2026_00011\.sql/g)).toHaveLength(3);
    expect(suite).toContain("savepoint attr_pre_migration_trigger;");
    expect(suite).toContain("rollback to savepoint attr_pre_migration_trigger;");
    // The installed-then-rolled-back trigger really is production's pre-ATTR one.
    const installed = fnIn(suite, "emit_customs_events");
    expect(triggerActors(sql(installed))).toEqual(triggerActors(sql(fnIn(read(PRE_ATTR_TRIGGER), "emit_customs_events"))));
    expect(suite).toMatch(/\\if :ERROR\s+rollback to savepoint attr_rerun;/);
  });

  it("asserts all four facts after every act of the sequence", () => {
    for (const stage of [
      "1 Chef validates step 7", "2 field agent records BAE", "3 Chef refuses the release",
      "4 field agent re-records BAE", "5 Chef approves the release", "6 field agent finalises the release",
    ]) {
      expect(suite).toContain(`pg_temp.attr_facts('${stage}'`);
    }
    expect(suite).toMatch(/attr_expect_actor\('2', c_cust, 'BAE_RECORDED', c_field\)/);
    expect(suite).toMatch(/attr_expect_actor\('6', c_cust, 'CUSTOMS_RELEASE_COMPLETED', c_field\)/);
    expect(suite).toMatch(/attr_expect_actor\('5', c_cust, 'CUSTOMS_RELEASE_APPROVED', c_chef\)/);
    expect(suite).toMatch(/attr_expect_actor\('1', c_cust, 'CUSTOMS_VALIDATED', c_chef\)/);
  });

  it("CI runs the suite before the journey and before the database stops, with a readable failure", () => {
    const at = ci.indexOf("supabase/tests/attr_customs_01_attribution_test.sql");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(ci.indexOf("Seed journey identities"));
    expect(at).toBeLessThan(ci.indexOf("Stop local Supabase"));
    expect(ci).toContain("ATTR-CUSTOMS-01 attribution suite failed");
  });

  it("the C-4 journey asserts attribution after every step 13 act", () => {
    const j = read("tests/journey/transit-customs.journey.ts");
    expect(j.match(/await expectCustomsAttribution\(/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    for (const event of ["CUSTOMS_VALIDATED", "BAE_RECORDED", "CUSTOMS_RELEASE_APPROVED", "CUSTOMS_RELEASE_COMPLETED"]) {
      expect(j).toContain(`customsEventActor(customsId, "${event}")`);
    }
    expect(j).toMatch(/after the release", \{ recorder: field\.id, approver: transit\.id, finaliser: field\.id \}/);
  });
});

// ===========================================================================
describe("step 13 behaviour is preserved", () => {
  it("step 13 still requires the BAE AND the finalised release", () => {
    expect(getStep("customs_field_clearance")?.requiredDocuments).toEqual(["BON_A_ENLEVER", "CUSTOMS_RELEASE"]);
    expect(ts(read("lib/process/engine/evidence.ts"))).toMatch(/snap\.customs\.status === "RELEASED"/);
  });

  it("the release still waits for the Chef's approval, and pickup still waits for RELEASED", () => {
    const actions = ts(read("lib/customs/actions.ts"));
    expect(tsFn(actions, "recordCustomsRelease")).toMatch(/rec\.release_approval_status !== "APPROVED"[\s\S]*?release_not_approved/);
    expect(tsFn(ts(read("lib/process/engine/transit-actions.ts")), "finalizeTransitRelease"))
      .toMatch(/release_approval_status !== "APPROVED"/);
    expect(ts(read("lib/transport/gates.ts"))).toMatch(/customs\.status === "RELEASED"/);
  });
});
