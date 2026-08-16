/**
 * EFFITRANS-HR-B2 — performance identity activation.
 * ---------------------------------------------------------------------------
 * HR-6 built the whole machine and left identity out: every stage rode
 * `hr:manage`, so HR typed the employee's self-assessment, the manager review
 * AND the employee's acknowledgment, while the manager snapshotted on each
 * evaluation was never read as authorization. HR-B2 replays the HR-B1 pattern:
 *
 *   SELF    — the employee acts on their own evaluation;
 *   MANAGER — the SNAPSHOTTED manager reviews it (not today's manager: the
 *             snapshot is the authority, so a re-assignment cannot hand over a
 *             half-finished review);
 *   ORG     — everyone else needs hr:manage, or hr:performance:finalize for
 *             the consequential act — asserted in the DATABASE (INV-7).
 *
 * Q2 (ratified) adds two NARROW C3 disclosure lanes without touching the
 * org-wide `hr:sensitive:read`: your own evaluation's prose, and — for the
 * manager of record — the self-assessment they must review.
 *
 * The RUNTIME proofs (lane by lane, refusal by refusal, against the real
 * functions) live in supabase/tests/hr_b2_performance_identity_test.sql. This
 * suite pins the pure disclosure rule and the structure that carries it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluationDisclosure, hasAnyDisclosure, FULL_DISCLOSURE, NO_DISCLOSURE,
} from "@/lib/hr/performance/disclosure";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
/** SQL with `--` comments stripped — prosrc-style scanning (the P1.1 lesson). */
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260831000001_hr_performance_identity_activation.sql";
const ACTIONS = "lib/hr/performance-actions.ts";
const SUITE = "supabase/tests/hr_b2_performance_identity_test.sql";

function action(name: string): string {
  const s = code(ACTIONS);
  const i = s.indexOf(`export async function ${name}`);
  expect(i, name).toBeGreaterThan(-1);
  const j = s.indexOf("export async function", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

/** The RPC body, comment-stripped, as the migration ships it. */
function rpc(name: string): string {
  const s = sql(MIG);
  const i = s.indexOf(`create or replace function public.${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  const j = s.indexOf("create or replace function public.", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

const EMP = "employee-1";
const MGR = "manager-1";
const OTHER = "someone-else";

// ===========================================================================
describe("Q2 — identity-scoped C3 disclosure, and nothing wider", () => {
  const evaluation = { employeeId: EMP, managerEmployeeId: MGR };

  it("the employee reads their OWN evaluation in full, finalized review included", () => {
    expect(evaluationDisclosure({ canReadSensitive: false, viewerEmployeeId: EMP, evaluation }))
      .toEqual(FULL_DISCLOSURE);
  });

  it("the SNAPSHOTTED manager reads the self-assessment and their own review — never HR's words", () => {
    // THE MUTATION TARGET. Widening this to `hr: true` would hand the manager
    // the finalizer's moderation note and final summary, which Q2 does not grant.
    expect(evaluationDisclosure({ canReadSensitive: false, viewerEmployeeId: MGR, evaluation }))
      .toEqual({ self: true, manager: true, hr: false });
  });

  it("everyone else sees NOTHING — no colleague, no former manager, no stranger", () => {
    expect(evaluationDisclosure({ canReadSensitive: false, viewerEmployeeId: OTHER, evaluation }))
      .toEqual(NO_DISCLOSURE);
    expect(evaluationDisclosure({ canReadSensitive: false, viewerEmployeeId: null, evaluation }))
      .toEqual(NO_DISCLOSURE);
    // An evaluation with NO manager of record discloses to no manager at all.
    expect(evaluationDisclosure({
      canReadSensitive: false, viewerEmployeeId: OTHER,
      evaluation: { employeeId: EMP, managerEmployeeId: null },
    })).toEqual(NO_DISCLOSURE);
  });

  it("the org-wide authority still opens everything — it was neither narrowed nor implied", () => {
    expect(evaluationDisclosure({ canReadSensitive: true, viewerEmployeeId: null, evaluation }))
      .toEqual(FULL_DISCLOSURE);
    expect(hasAnyDisclosure(NO_DISCLOSURE)).toBe(false);
    expect(hasAnyDisclosure({ self: true, manager: false, hr: false })).toBe(true);
  });

  it("the identity lanes never grant, imply or require hr:sensitive:read", () => {
    const d = code("lib/hr/performance/disclosure.ts");
    expect(d).not.toContain("hasPermission");
    // The migration ASSERTS the broad permission stayed ungranted.
    expect(read(MIG)).toMatch(/p\.code = 'hr:sensitive:read'[\s\S]{0,200}raise exception/);
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.permissions, t.key).not.toContain("hr:sensitive:read");
    }
  });
});

// ===========================================================================
describe("the reads honour the lanes — and keep the withholding discipline", () => {
  const p = code("lib/hr/performance.ts");

  it("prose is fetched ONLY for rows the reader has a lane on", () => {
    // THE MUTATION TARGET. Dropping the narrowing would pull colleagues' C3
    // prose into a request that may only see its own row.
    expect(p).toContain("or(`employee_id.eq.${viewer},manager_employee_id.eq.${viewer}`)");
    expect(p).toContain("if (ids.length === 0 || (!reader.canReadSensitive && !viewer)) return new Map()");
  });

  it("the workflow projection still names no prose column", () => {
    const workflow = p.slice(p.indexOf("const WORKFLOW_COLUMNS"), p.indexOf("const C3_COLUMNS"));
    for (const c of ["self_comments", "manager_comments", "manager_strengths",
                     "manager_development", "recommended_actions", "moderation_note", "final_summary"]) {
      expect(workflow, c).not.toContain(c);
    }
  });

  it("each row is mapped through the pure rule, per row", () => {
    expect(p).toContain("evaluationDisclosure({");
    expect(p).toContain("contentWithheld: !hasAnyDisclosure(scope)");
    expect(p).toContain("selfComments: scope.self");
    expect(p).toContain("moderationNote: scope.hr");
  });
});

// ===========================================================================
describe("the RPCs carry the authority — every one of them", () => {
  const RPCS = [
    "hr_open_performance_cycle", "hr_submit_self_assessment", "hr_submit_manager_review",
    "hr_finalize_evaluation", "hr_acknowledge_evaluation", "hr_assign_objective",
  ];

  it("actor integrity (HR630) precedes every action, in all six", () => {
    for (const name of RPCS) {
      const body = rpc(name);
      expect(body, name).toContain("HR630");
      expect(body, name).toContain("u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active'");
      expect(body, name).toContain("assert_actor_authority");
    }
  });

  it("the SELF lane reads the account link and the evaluation's own employee", () => {
    for (const name of ["hr_submit_self_assessment", "hr_acknowledge_evaluation"]) {
      const body = rpc(name);
      expect(body, name).toContain("e.linked_app_user_id = p_actor and e.status = 'ACTIVE'");
      expect(body, name).toContain("v_is_self := v_actor_emp is not null and v_actor_emp = v_employee");
      expect(body, name).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE')");
    }
  });

  it("the MANAGER lane reads the SNAPSHOT — never a live assignment lookup", () => {
    // THE MUTATION TARGET. Reading employee_assignment here would let a
    // re-assignment hand a stranger someone's half-finished review.
    const body = rpc("hr_submit_manager_review");
    expect(body).toContain("v_actor_emp = v_manager_emp");
    expect(body).toContain("manager_employee_id");
    expect(body).not.toContain("employee_assignment");
    expect(body).toContain("HR631"); // nobody reviews their own evaluation
  });

  it("finalization is TWO lanes and HR616 survives both", () => {
    const body = rpc("hr_finalize_evaluation");
    expect(body).toContain("HR616");
    expect(body).toContain("v_actor_emp = v_manager_emp");
    expect(body).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:performance:finalize', 'SERVICE')");
    expect(body).not.toContain("employee_assignment");
    // HR616 is evaluated BEFORE the lane resolution: whoever wrote the review
    // is refused no matter which lane would otherwise admit them.
    expect(body.indexOf("HR616")).toBeLessThan(body.indexOf("v_is_manager :="));
    // …and the weight rule is still enforced here.
    expect(body).toContain("HR617");
  });

  it("the HR-desk-only RPCs assert hr:manage outright", () => {
    for (const name of ["hr_open_performance_cycle", "hr_assign_objective"]) {
      expect(rpc(name), name).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE')");
    }
  });

  it("the RPCs stay service_role transport — asserted at apply time", () => {
    const m = read(MIG);
    expect(m).toContain("has_function_privilege('anon'");
    expect(m).toContain("grant execute on function public.hr_finalize_evaluation(uuid,uuid,uuid,text,text) to service_role");
    expect(m).toMatch(/revoke execute on function public\.hr_submit_manager_review[\s\S]{0,120}from public, anon, authenticated/);
  });
});

// ===========================================================================
describe("the finalization seat — Direction only, CEO asserted ungranted", () => {
  it("migration 109 grants hr:performance:finalize to DGA and DAF, idempotently", () => {
    const m = sql(MIG);
    expect(m).toMatch(/p\.code = 'hr:performance:finalize'[\s\S]{0,80}r\.code in \('DGA', 'DAF'\)/);
    expect(m).toContain("on conflict do nothing");
  });

  it("seed.sql mirrors the grant — DAF/DGA, never CEO", () => {
    const blocks = read("supabase/seed.sql")
      .match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    const seat = blocks.filter((b) => b.includes("'hr:performance:finalize'"));
    expect(seat).toHaveLength(1);
    expect(seat[0]).toContain("'DAF', 'DGA'");
    expect(seat[0]).not.toContain("CEO");
  });

  it("the role templates mirror the grant on DGA/DAF alone", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      const holds = t.permissions.includes("hr:performance:finalize");
      expect(holds, `${t.key} hr:performance:finalize`).toBe(t.key === "DGA" || t.key === "DAF");
    }
  });

  it("THE GOVERNANCE BOUNDARY: the migration refuses to apply if CEO or HR_OFFICER acquire it", () => {
    const m = read(MIG);
    expect(m).toMatch(/r\.code = 'CEO' and p\.code = 'hr:performance:finalize'[\s\S]{0,240}raise exception/);
    expect(m).toMatch(/r\.code = 'HR_OFFICER' and p\.code = 'hr:performance:finalize'[\s\S]{0,240}raise exception/);
    expect(m).toMatch(/r\.code = 'SYSTEM_ADMIN' and p\.code like 'hr:%'[\s\S]{0,240}raise exception/);
  });
});

// ===========================================================================
describe("the actions resolve identity and let the database decide", () => {
  it("no stage action gates a permission — that would block the identity lanes", () => {
    for (const name of ["submitSelfAssessment", "submitManagerReview", "finalizeEvaluation", "acknowledgeEvaluation"]) {
      const b = action(name);
      expect(b, name).not.toContain("assertPermission(");
      expect(b, name).toContain("await actor()");
      expect(b, name).toContain("rpc(");
    }
  });

  it("the HR-desk actions keep their own gates", () => {
    expect(action("createPerformanceCycle")).toContain('assertPermission("hr:manage")');
    expect(action("assignObjective")).toContain('assertPermission("hr:manage")');
    expect(action("upsertCompetency")).toContain('assertPermission("hr:config:manage")');
  });

  it("EFA refusals become a French-facing code, never a raw SQLSTATE", () => {
    const s = code(ACTIONS);
    expect(s).toContain('e?.code?.startsWith("EFA") ? "forbidden_stage"');
    expect(s).toContain('HR630: "actor_invalid"');
    expect(s).toContain('HR631: "own_evaluation"');
  });

  it("the audit still records stages, never prose", () => {
    const s = code(ACTIONS);
    for (const m of s.match(/writeAudit\(\{[\s\S]*?\}\);/g) ?? []) {
      for (const c of ["comments", "strengths", "development", "moderationNote",
                       "finalSummary", "managerAssessment", "p_comments"]) {
        expect(m, c).not.toContain(c);
      }
    }
  });

  it("cycle_kind is validated against hr_configuration — empty vocabulary allows anything", () => {
    const b = action("createPerformanceCycle");
    expect(b).toContain("performance_cycle_kinds");
    expect(b).toContain('"invalid_cycle_kind"');
    expect(b).toContain("kinds.length > 0 &&");
    // The column exists and the migration seeds NO value into it.
    expect(sql(MIG)).toContain("add column if not exists performance_cycle_kinds jsonb not null default '[]'::jsonb");
    expect(read(MIG)).toMatch(/jsonb_array_length\(performance_cycle_kinds\) > 0[\s\S]{0,200}raise exception/);
  });
});

// ===========================================================================
describe("the surfaces, in French, scoped by identity", () => {
  it("« Mes évaluations » exists, ungated like /conges, and is in the sidebar TWICE over", () => {
    const page = read("app/evaluations/page.tsx");
    expect(page).toContain("Mes évaluations");
    expect(page).not.toContain("notFound()");
    // Both nav sources — the base AND the flag-ON branch that rebuilds Pilotage.
    expect(read("lib/nav.ts")).toContain('href: "/evaluations"');
    expect(code("lib/navigation/build.ts")).toContain("myEvaluations");
  });

  it("the studio speaks French and leaks no code", () => {
    const s = read("components/hr/my-evaluations-studio.tsx");
    for (const t of ["Mes évaluations", "Évaluations de mon équipe", "Soumettre mon auto-évaluation",
                     "Transmettre ma revue", "J&apos;accuse réception", "Finaliser"]) {
      expect(s, t).toContain(t);
    }
    expect(s).toContain("ne vaut pas approbation");
    expect(s).not.toMatch(/hr:sensitive:read|hr:performance:finalize|EFA\d|HR6\d\d/);
  });

  it("the manager queue reads the SNAPSHOT, and the team lane is bounded by it", () => {
    const s = code("lib/hr/my-performance.ts");
    expect(s).toContain("managerEmployeeId: active.id");
    expect(s).not.toContain("employee_assignment");
    // Mon Travail stays untouched, for the reason HR-B1 recorded.
    expect(read("lib/hr/my-performance.ts")).toContain("NOT « Mon Travail »");
    expect(read("lib/navigation/workbench.ts")).not.toMatch(/évaluation|performance/i);
  });

  it("the workspace never widens the reader's own permissions", () => {
    const s = code("lib/hr/my-performance.ts");
    expect(s).toContain("canReadSensitive: opts.canReadSensitive");
    expect(s).not.toContain("hasPermission");
  });
});

// ===========================================================================
describe("scope held — nothing invented, nothing else started", () => {
  it("no competency, scale, rating, score or cadence is seeded anywhere", () => {
    // Scanned on the STATEMENTS, not the header prose that explains what the
    // migration refuses to invent.
    const m = sql(MIG);
    expect(m).not.toMatch(/insert into public\.hr_competency/i);
    expect(m).not.toMatch(/scale_labels|overall_score|rating|bonus|salaire|sanction/i);
    // The one new column ships EMPTY.
    expect(m).toContain("default '[]'::jsonb");
  });

  it("HR-6's own machinery is reused, not rebuilt: no new table, no RLS change", () => {
    const m = sql(MIG);
    expect(m).not.toMatch(/create table/i);
    expect(m).not.toMatch(/create policy|alter table \w+ enable row level security/i);
    expect(m).not.toMatch(/drop (table|column|trigger|policy)/i);
  });

  it("migration 109 exists, the ledger is consistent, and the suite runs in CI last", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(migrations).toContain("20260831000001_hr_performance_identity_activation.sql");
    expect(migrations).toHaveLength(
      Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]),
    );
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(`-f ${SUITE}`);
  });

  it("the live suite exercises the decisive cases by name", () => {
    const s = read(SUITE);
    for (const t of ["HR630", "HR631", "HR616", "EFA15",
                     "only the SNAPSHOTTED manager may review",
                     "an ungranted CEO holder must not finalize",
                     "the HR desk must keep its proxy lane"]) {
      expect(s, t).toContain(t);
    }
    // EFA08 discipline: the suite holds no session while calling the RPCs.
    expect(s).toContain("select set_config('request.jwt.claims', '', true)");
  });
});
