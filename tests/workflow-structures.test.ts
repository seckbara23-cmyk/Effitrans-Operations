/**
 * Phase 9.0B — workflow structural extensions: canonical owner, recorded
 * decisions, formal blockers, Transit teams, explicit skips.
 * ---------------------------------------------------------------------------
 * Pure contracts are tested directly; server-action guarantees (server-derived
 * actor/tenant, permission gates, CAS, audit) are asserted structurally against
 * the real source, per repo convention. DB-level guarantees (RLS, tenant
 * triggers, decision immutability) are proven by
 * supabase/tests/rls_workflow_structures_test.sql in the rls-tests CI job.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveEffectiveProcessOwner } from "@/lib/process/ownership";
import {
  STEP_APPLICABILITY,
  stepAppliesToFileType,
  inapplicableStepsFor,
  definitionSkippableSteps,
} from "@/lib/process/applicability";
import { DECISION_TYPES, DECISION_OUTCOMES, DECISION_POLICIES, isDecisionType, isDecisionOutcome } from "@/lib/process/decision-policy";
import { canTransitionStep } from "@/lib/process/engine/state";
import { isDone } from "@/lib/process/engine/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import { TRANSIT_TEAMS } from "@/lib/organization/departments";
import { toPortalTimeline } from "@/lib/portal/progress-map";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("../lib/process/engine/structures-actions.ts");
const migration = read("../supabase/migrations/20260723000001_workflow_structures.sql");
const progressMap = read("../lib/portal/progress-map.ts");

// ==================================================== ownership (tests 1-7) ====

describe("canonical ownership", () => {
  it("1 — owner is separate from task assignment: assigning an owner never touches step assignees", () => {
    const assignFn = actions.slice(actions.indexOf("export async function assignProcessOwner"), actions.indexOf("export async function requestProcessDecision"));
    expect(assignFn).toContain("owner_user_id");
    expect(assignFn).not.toContain("assigned_user_id");
  });

  it("2 — effective-owner resolver follows the documented precedence", () => {
    const all = { ownerUserId: "o", coordinatorId: "c", accountManagerId: "am", createdBy: "cr" };
    expect(resolveEffectiveProcessOwner(all)).toEqual({ userId: "o", source: "canonical" });
    expect(resolveEffectiveProcessOwner({ ...all, ownerUserId: null })).toEqual({ userId: "c", source: "coordinator" });
    expect(resolveEffectiveProcessOwner({ coordinatorId: null, accountManagerId: "am", createdBy: "cr" })).toEqual({ userId: "am", source: "account_manager" });
    expect(resolveEffectiveProcessOwner({ createdBy: "cr" })).toEqual({ userId: "cr", source: "creator" });
    expect(resolveEffectiveProcessOwner({})).toEqual({ userId: null, source: "none" });
  });

  it("2b — an invalid legacy candidate is passed over (a departed coordinator never resolves)", () => {
    const valid = new Set(["am"]);
    expect(resolveEffectiveProcessOwner({ coordinatorId: "departed", accountManagerId: "am" }, valid))
      .toEqual({ userId: "am", source: "account_manager" });
  });

  it("3/4 — cross-tenant and inactive owners are rejected server-side (loadActiveStaff gate)", () => {
    expect(actions).toContain('staff.tenant_id !== tenantId || staff.status !== "active"');
    const assignFn = actions.slice(actions.indexOf("export async function assignProcessOwner"));
    expect(assignFn).toContain("loadActiveStaff(admin, ctx.tenantId, input.ownerUserId)");
  });

  it("5 — a non-Operations owner is rejected (canonical registry check, no override in 9.0B)", () => {
    expect(actions).toContain('roleCanonicalDepartment(code) === "OPERATIONS"');
    expect(actions).toContain('if (!isOperations) return fail("forbidden")');
  });

  it("6 — legacy records stay readable: owner columns are nullable, no backfill exists", () => {
    expect(migration).toContain("add column if not exists owner_user_id");
    expect(migration).not.toMatch(/update public\.process_instance\s+set owner_user_id/i);
  });

  it("7 — owner changes are audited with before/after", () => {
    expect(actions).toContain("PROCESS_OWNER_CHANGED");
    expect(actions).toContain("PROCESS_OWNER_ASSIGNED");
    expect(actions).toContain("before: { owner_user_id: before }");
  });
});

// ==================================================== decisions (tests 8-15) ====

describe("workflow decisions", () => {
  it("8 — the continue-before-payment decision requires a reason", () => {
    expect(actions).toContain('if (!input.reason || input.reason.trim().length === 0) return fail("reason_required")');
    expect(migration).toContain("reason                    text not null");
  });

  it("9 — decision actor and tenant are server-derived (requested_by/decided_by = session, never input)", () => {
    expect(actions).toContain("requested_by: ctx.userId");
    expect(actions).toContain("decided_by: ctx.userId");
    expect(actions).not.toMatch(/requested_by:\s*input\.|decided_by:\s*input\./);
  });

  it("10 — finalization is gated on process:decision:approve plus the per-type policy", () => {
    const fin = actions.slice(actions.indexOf("export async function finalizeProcessDecision"));
    expect(fin).toContain('structuresGuard("process:decision:approve"');
    expect(fin).toContain("DECISION_POLICIES[decision.decision_type as DecisionType]");
  });

  it("11 — a finalized decision is immutable at the DATABASE level", () => {
    expect(migration).toContain("a finalized process decision is immutable");
    expect(migration).toContain("trg_process_decision_immutable before update or delete");
  });

  it("12 — superseding creates a NEW row referencing the old one; only FINALIZED decisions can be superseded", () => {
    expect(migration).toContain("supersedes_decision_id    uuid references public.process_decision (id)");
    const req = actions.slice(actions.indexOf("export async function requestProcessDecision"));
    expect(req).toContain('if (prior.status !== "FINALIZED") return fail("invalid_state")');
  });

  it("13 — a continue decision never touches payment or invoice records", () => {
    const decisionsSection = actions.slice(actions.indexOf("requestProcessDecision"), actions.indexOf("// ================================================================= blockers"));
    expect(decisionsSection).not.toMatch(/from\("payment"\)|from\("invoice"\)/);
  });

  it("14/15 — customers and other tenants cannot read decisions (no portal RLS policy; tenant+permission-gated select)", () => {
    // The ONLY select policy on process_decision is the staff one — grep proves no portal policy exists.
    const policies = migration.match(/create policy \w+ on public\.process_decision[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain("has_permission('process:read')");
    expect(policies[0]).toContain("auth_tenant_id()");
    expect(migration).not.toMatch(/process_decision[\s\S]{0,400}auth_portal/);
  });

  it("decision-type/outcome vocabulary matches the business document", () => {
    expect([...DECISION_TYPES]).toEqual(["CONTINUE_BEFORE_PAYMENT"]);
    expect([...DECISION_OUTCOMES.CONTINUE_BEFORE_PAYMENT]).toEqual([
      "BLOCK_UNTIL_PAYMENT", "CONTINUE_PROVISIONALLY", "CONTINUE_WITH_APPROVAL",
    ]);
    expect(isDecisionType("CONTINUE_BEFORE_PAYMENT")).toBe(true);
    expect(isDecisionType("SOMETHING_ELSE")).toBe(false);
    expect(isDecisionOutcome("CONTINUE_BEFORE_PAYMENT", "CONTINUE_PROVISIONALLY")).toBe(true);
    expect(isDecisionOutcome("CONTINUE_BEFORE_PAYMENT", "PAID")).toBe(false);
    // The approval policy is DATA (configurable), not hardcoded conditionals.
    expect(DECISION_POLICIES.CONTINUE_BEFORE_PAYMENT.approvalRequired).toBe(true);
    expect(DECISION_POLICIES.CONTINUE_BEFORE_PAYMENT.requiredPermission).toBe("process:decision:approve");
  });
});

// ==================================================== blockers (tests 16-22) ====

describe("formal blockers", () => {
  it("16 — multiple active blockers per process: no uniqueness constraint restricts them", () => {
    const blockerSection = migration.slice(migration.indexOf("create table public.process_blocker"), migration.indexOf("organization_team_member"));
    expect(blockerSection).not.toMatch(/create unique index/);
  });

  it("17 — a blocker may target a step or the whole dossier (step FK nullable)", () => {
    expect(migration).toContain("process_step_execution_id uuid references public.process_step_execution (id)");
  });

  it("18 — resolving a blocker never completes a step (no step-state write in the blocker path)", () => {
    const blockerSection = actions.slice(actions.indexOf("// ================================================================= blockers"), actions.indexOf("// ============================================================ Transit teams"));
    expect(blockerSection).not.toMatch(/from\("process_step_execution"\)[\s\S]*?\.update/);
  });

  it("19/20 — internal description never reaches a customer; customer_visible requires a SEPARATE approved message", () => {
    expect(actions).toContain("if (input.customerVisible && !input.customerMessage?.trim())");
    // The audit payload carries category/severity — never the description body.
    const openFn = actions.slice(actions.indexOf("export async function openProcessBlocker"), actions.indexOf("const BLOCKER_TRANSITIONS"));
    const auditPayload = openFn.slice(openFn.indexOf("writeAudit"));
    expect(auditPayload).not.toContain("description");
  });

  it("21 — cross-tenant blocker access is denied (single tenant+permission select policy, DB tenant trigger)", () => {
    const policies = migration.match(/create policy \w+ on public\.process_blocker[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain("auth_tenant_id()");
    expect(migration).toContain("blocker tenant mismatch");
  });

  it("22 — the blocker lifecycle is fully audited (open/acknowledge/resolve/cancel)", () => {
    for (const a of ["PROCESS_BLOCKER_OPENED", "PROCESS_BLOCKER_ACKNOWLEDGED", "PROCESS_BLOCKER_RESOLVED", "PROCESS_BLOCKER_CANCELLED"]) {
      expect(actions, a).toContain(a);
    }
    // Resolution requires a note; state machine is explicit and terminal states are closed.
    expect(actions).toContain('return fail("reason_required")');
    expect(actions).toContain("RESOLVED: []");
  });
});

// ==================================================== teams (tests 23-29) ====

describe("Transit teams", () => {
  it("23/24 — AIBD and MARITIME are the only team codes, both mapped to TRANSIT in the canonical registry", () => {
    expect(TRANSIT_TEAMS.map((t) => t.code).sort()).toEqual(["AIBD", "MARITIME"]);
    for (const t of TRANSIT_TEAMS) expect(t.department).toBe("TRANSIT");
    expect(migration).toContain("check (team_code in ('AIBD', 'MARITIME'))");
  });

  it("25/29 — membership is tenant-scoped: RLS confines to auth_tenant_id, DB trigger rejects cross-tenant members", () => {
    expect(migration).toContain("create policy org_team_member_select");
    expect(migration).toContain("team member belongs to another tenant");
  });

  it("26 — inactive users cannot be team members (loadActiveStaff gate on add)", () => {
    const addFn = actions.slice(actions.indexOf("export async function addTeamMember"), actions.indexOf("export async function removeTeamMember"));
    expect(addFn).toContain("loadActiveStaff(admin, ctx.tenantId, userId)");
  });

  it("27 — team membership grants NOTHING: the actions never write role_permission/user_role", () => {
    expect(actions).not.toMatch(/from\("role_permission"\)[\s\S]{0,200}\.(insert|update)|from\("user_role"\)[\s\S]{0,200}\.(insert|update)/);
  });

  it("28 — a user may belong to both teams (uniqueness is per (tenant, team, user), not per user)", () => {
    expect(migration).toContain("on public.organization_team_member (tenant_id, team_code, app_user_id)");
  });

  it("team assignment on a step targets the TEAM, not every member (assigned_team_code only)", () => {
    const teamAssign = actions.slice(actions.indexOf("export async function assignStepTeam"));
    expect(teamAssign).toContain("assigned_team_code: teamCode");
    expect(teamAssign).not.toContain("assigned_user_id");
  });

  it("membership changes and step team targeting are audited", () => {
    for (const a of ["PROCESS_TEAM_MEMBER_ADDED", "PROCESS_TEAM_MEMBER_REMOVED", "PROCESS_TEAM_ASSIGNED"]) {
      expect(actions, a).toContain(a);
    }
  });
});

// ==================================================== skips (tests 30-38) ====

describe("explicit skipped steps", () => {
  it("30/31 — skipped is neither completed nor cancelled, but counts as done for closure", () => {
    expect(isDone("SKIPPED")).toBe(true); // closure readiness accepts it
    expect(canTransitionStep("COMPLETED", "SKIPPED")).toBe(false); // never a relabel of done work
    expect(canTransitionStep("CANCELLED", "SKIPPED")).toBe(false);
    expect(canTransitionStep("ACTIVE", "SKIPPED")).toBe(false); // started work is never definition-discarded
    expect(canTransitionStep("PENDING", "SKIPPED")).toBe(true);
    expect(canTransitionStep("AVAILABLE", "SKIPPED")).toBe(true);
  });

  it("32 — skip requires reason, actor, timestamp and a declared source (DEFINITION or MANUAL)", () => {
    expect(actions).toContain("skip_reason: input.reason.trim()");
    expect(actions).toContain("skipped_by: ctx.userId");
    expect(actions).toContain("skipped_at: new Date().toISOString()");
    expect(migration).toContain("check (skip_source is null or skip_source in ('DEFINITION', 'MANUAL'))");
  });

  it("33 — an authorized skipped step satisfies closure readiness (isDone includes SKIPPED — existing evaluator rule)", () => {
    expect(isDone("SKIPPED")).toBe(true);
  });

  it("34 — an unauthorized skip is denied: the action gates on process:step:skip", () => {
    const skipFn = actions.slice(actions.indexOf("export async function skipStep"));
    expect(skipFn).toContain('structuresGuard("process:step:skip"');
  });

  it("35 — a skipped step can be reopened, audited, back to PENDING only", () => {
    expect(canTransitionStep("SKIPPED", "PENDING")).toBe(true);
    expect(canTransitionStep("SKIPPED", "COMPLETED")).toBe(false);
    expect(canTransitionStep("SKIPPED", "AVAILABLE")).toBe(false);
    expect(actions).toContain("PROCESS_STEP_SKIP_REOPENED");
  });

  it("36 — the customer timeline never renders a skipped state: an internally skipped step displays as completed", () => {
    // The OUTPUT status vocabulary is completed/current/pending — "skipped" appears
    // only on the INPUT side, where it counts as done so the timeline flows.
    const statusUnion = progressMap.slice(progressMap.indexOf("PortalStageStatus"), progressMap.indexOf("PortalStageKey"));
    expect(statusUnion).not.toContain('"skipped"');
    const timeline = toPortalTimeline([
      { key: "documents_collection", status: "completed" },
      { key: "documents_verified", status: "completed" },
      { key: "customs_cleared", status: "skipped" }, // internally skipped customs leg
      { key: "release_authorized", status: "skipped" },
    ]);
    const statuses = new Set(timeline.stages.map((s) => s.status));
    expect([...statuses].every((s) => ["completed", "current", "pending"].includes(s))).toBe(true);
    expect(timeline.stages.find((s) => s.key === "customs_in_progress")!.status).toBe("completed");
  });

  it("37 — mode-specific deterministic skip: the applicability registry drives DEFINITION skips", () => {
    // The customs chain does not apply to TRP/HND…
    expect(stepAppliesToFileType("customs_preparation", "TRP")).toBe(false);
    expect(stepAppliesToFileType("customs_preparation", "HND")).toBe(false);
    expect(stepAppliesToFileType("customs_preparation", "IMP")).toBe(true);
    // …generic steps apply to everything…
    expect(stepAppliesToFileType("coordinator_reception", "TRP")).toBe(true);
    expect(stepAppliesToFileType("pickup", "HND")).toBe(true);
    // …and the derived skip set only includes not-yet-started executions.
    expect(inapplicableStepsFor("TRP")).toContain("gainde_registration");
    expect(inapplicableStepsFor("IMP")).toEqual([]);
    const skippable = definitionSkippableSteps("TRP", [
      { stepKey: "customs_preparation", state: "PENDING" },
      { stepKey: "customs_followup", state: "ACTIVE" }, // started — never auto-discarded
      { stepKey: "pickup", state: "PENDING" }, // applies — never skipped
    ]);
    expect(skippable).toEqual(["customs_preparation"]);
    // A DEFINITION skip must actually be definition-backed for the dossier's type.
    expect(actions).toContain("if (stepAppliesToFileType(stepKey, file.type))");
  });

  it("38 — historical rows stay readable: skip columns are additive/nullable, reopen clears them", () => {
    expect(migration).toContain("add column if not exists skipped_by");
    const reopenFn = actions.slice(actions.indexOf("export async function reopenSkippedStep"));
    expect(reopenFn).toContain("skip_source: null");
  });
});

// =========================================== dark rollout + guard structure ====

describe("dark rollout — everything refuses until both flags AND the tenant gate are on", () => {
  it("the structures sub-flag requires the master and defaults off", () => {
    expect(resolveProcessFlags({}).structures).toBe(false);
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true" }).structures).toBe(false); // no master
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" }).structures).toBe(false); // no sub-flag
    expect(
      resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true", EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true" }).structures,
    ).toBe(true);
  });

  it("every action funnels through structuresGuard (kill switch + structures + tenant flags + visibility)", () => {
    expect(actions).toContain("if (!kill.enabled || !kill.structures)");
    expect(actions).toContain("if (!tenantFlags.enabled || !tenantFlags.structures)");
    for (const fn of [
      "assignProcessOwner", "requestProcessDecision", "finalizeProcessDecision", "openProcessBlocker",
      "addTeamMember", "removeTeamMember", "assignStepTeam", "skipStep", "reopenSkippedStep",
    ]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 600), fn).toContain("structuresGuard(");
    }
  });

  it("no automatic generation anywhere: nothing calls skip/blocker/decision actions from init or other engine paths", () => {
    const init = code("../lib/process/engine/init.ts");
    const engineActions = code("../lib/process/engine/actions.ts");
    for (const src of [init, engineActions]) {
      expect(src).not.toMatch(/skipStep|openProcessBlocker|requestProcessDecision|assignProcessOwner/);
    }
  });
});
