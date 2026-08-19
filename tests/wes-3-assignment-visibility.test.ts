/**
 * Phase WES-3 — ownership, assignment, department visibility, history.
 *
 * The pure resolver carries the WES-3C matrix, so most of it is tested without
 * a database. Structural SQL assertions use `sqlCode()`: `code()` strips `//`
 * and `/* *\/` but NOT SQL `--`, and a migration header can otherwise satisfy a
 * test about its own code (the mistake WES-9A had to correct).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  resolveDossierAccess,
  departmentRelation,
  mayCompleteWork,
  explainAccessFr,
  ACCESS_REASON_LABELS_FR,
  ACCESS_REASONS,
  type DossierAccessInput,
} from "@/lib/workflow/access/resolver";
import {
  LIFECYCLE_DEPARTMENT_TO_CANONICAL,
  belongsToLifecycleDepartment,
  canonicalDepartmentForLifecycle,
  canonicalDepartmentsForRoles,
  bridgeIsTotal,
} from "@/lib/workflow/access/departments";
import { isEligibleForSeat } from "@/lib/workflow/access/seat";
import { getEventType, isKnownEventType } from "@/lib/workflow/events/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260727000002_assignment_history.sql";
const sql = () => sqlCode(MIGRATION);

// A Transit user (customs department), a documentation user, a finance user.
const TRANSIT_ROLES = ["CUSTOMS_DECLARANT"];
const OPS_ROLES = ["COORDINATOR"];
const FINANCE_ROLES = ["FINANCE_OFFICER"];

function base(overrides: Partial<DossierAccessInput> = {}): DossierAccessInput {
  return {
    userId: "u1",
    roleCodes: [],
    permissions: [],
    commercialOwnerId: null,
    operationalOwnerId: null,
    responsibleDepartment: "customs",
    currentStage: "customs",
    currentTaskAssigneeId: null,
    currentStepAssigneeId: null,
    supervisorRoles: [],
    contributedFromDepartments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// department bridge
// ---------------------------------------------------------------------------
describe("WES-3 department bridge", () => {
  it("maps every lifecycle department to a real organization department", () => {
    const all = ["opening", "documentation", "customs", "transport", "finance", "archive"] as const;
    expect(bridgeIsTotal(all)).toBe(true);
  });

  it("never routes dossier work to HUMAN_RESOURCES", () => {
    for (const dept of Object.values(LIFECYCLE_DEPARTMENT_TO_CANONICAL)) {
      expect(dept).not.toBe("HUMAN_RESOURCES");
    }
  });

  // PIN MOVED (TMS-5C, 2026-08-18): the transport STAGE follows the Transport
  // department. This had to move with ROLE_CANONICAL_DEPARTMENT — remapping the
  // roles alone would have taken the transport stage out of the transport
  // team's own queue, which is the one outcome the realignment must not cause.
  it("places customs under TRANSIT, transport under TRANSPORT, billing under FINANCE", () => {
    expect(canonicalDepartmentForLifecycle("customs")).toBe("TRANSIT");
    expect(canonicalDepartmentForLifecycle("transport")).toBe("TRANSPORT");
    expect(canonicalDepartmentForLifecycle("finance")).toBe("FINANCE");
    expect(canonicalDepartmentForLifecycle("opening")).toBe("OPERATIONS");
  });

  it("derives membership from ROLES, never from a stored column", () => {
    expect(canonicalDepartmentsForRoles(TRANSIT_ROLES)).toContain("TRANSIT");
    expect(canonicalDepartmentsForRoles([])).toEqual([]);
    expect(belongsToLifecycleDepartment(TRANSIT_ROLES, "customs")).toBe(true);
    expect(belongsToLifecycleDepartment(FINANCE_ROLES, "customs")).toBe(false);
  });

  it("adds NO department column to any table (9.0A: department stays derived)", () => {
    expect(sql()).not.toMatch(/add column .*department/i);
    expect(sql()).not.toMatch(/alter table public\.app_user/i);
  });
});

// ---------------------------------------------------------------------------
// WES-3C visibility matrix
// ---------------------------------------------------------------------------
describe("WES-3C visibility matrix", () => {
  it("responsible-department member sees the dossier and current detail", () => {
    const a = resolveDossierAccess(base({ roleCodes: TRANSIT_ROLES }));
    expect(a.canViewSummary).toBe(true);
    expect(a.canViewCurrentDepartmentDetail).toBe(true);
    expect(a.reasons).toContain("responsible_department");
  });

  it("an unrelated department sees NOTHING", () => {
    // HR processes no dossiers and sits on no stage.
    const a = resolveDossierAccess(base({ roleCodes: ["HR_OFFICER"] }));
    expect(a.canViewSummary).toBe(false);
    expect(a.canViewCurrentDepartmentDetail).toBe(false);
    expect(a.visibilityReason).toBe("none");
  });

  it("a FUTURE department sees summary ONLY", () => {
    // Finance is downstream of customs.
    const a = resolveDossierAccess(base({ roleCodes: FINANCE_ROLES }));
    expect(a.canViewSummary).toBe(true);
    expect(a.canViewCurrentDepartmentDetail).toBe(false);
    expect(a.canViewDocuments).toBe(false);
    expect(a.canViewHistoricalDepartmentDetail).toBe(false);
    expect(a.reasons).toContain("future_department");
  });

  it("a PREVIOUS department sees bounded history only WITH verified contribution", () => {
    // Operations (documentation) is upstream of customs.
    const withoutHistory = resolveDossierAccess(base({ roleCodes: OPS_ROLES }));
    expect(withoutHistory.canViewHistoricalDepartmentDetail).toBe(false);

    const withHistory = resolveDossierAccess(
      base({ roleCodes: OPS_ROLES, contributedFromDepartments: ["documentation"] }),
    );
    expect(withHistory.canViewSummary).toBe(true);
    expect(withHistory.canViewHistoricalDepartmentDetail).toBe(true);
    expect(withHistory.canViewDocuments).toBe(true);
    // …but never current work.
    expect(withHistory.canViewCurrentDepartmentDetail).toBe(false);
    expect(withHistory.canCompleteAssignedTask).toBe(false);
  });

  it("holding a role is NOT a claim of having contributed", () => {
    // Same roles, no ledger entry ⇒ no historical detail. This is what stops
    // "I am in Documentation" becoming "I worked on this dossier".
    const a = resolveDossierAccess(base({ roleCodes: OPS_ROLES, contributedFromDepartments: [] }));
    expect(a.reasons).not.toContain("previous_department");
  });

  it("the operational owner retains oversight across departments", () => {
    const a = resolveDossierAccess(
      base({ userId: "owner", operationalOwnerId: "owner", roleCodes: [] }),
    );
    expect(a.canViewSummary).toBe(true);
    expect(a.canViewCurrentDepartmentDetail).toBe(true);
    expect(a.canViewHistoricalDepartmentDetail).toBe(true);
    expect(a.canIntervene).toBe(true);
  });

  it("the commercial owner sees the dossier but does not run it", () => {
    const a = resolveDossierAccess(base({ userId: "am", commercialOwnerId: "am" }));
    expect(a.canViewSummary).toBe(true);
    expect(a.canIntervene).toBe(false);
    expect(a.canCompleteAssignedTask).toBe(false);
  });

  it("a task assignee gets the access the work needs", () => {
    const a = resolveDossierAccess(base({ userId: "w", currentTaskAssigneeId: "w" }));
    expect(a.canViewCurrentDepartmentDetail).toBe(true);
    expect(a.canActOnCurrentStep).toBe(true);
    expect(a.canCompleteAssignedTask).toBe(true);
  });

  it("a step assignee likewise", () => {
    const a = resolveDossierAccess(base({ userId: "w", currentStepAssigneeId: "w" }));
    expect(a.canActOnCurrentStep).toBe(true);
    expect(a.reasons).toContain("step_assignee");
  });

  it("REASSIGNMENT DOES NOT MAKE THE DOSSIER DISAPPEAR — the WES-3 guarantee", () => {
    const before = resolveDossierAccess(
      base({ userId: "w", roleCodes: TRANSIT_ROLES, currentTaskAssigneeId: "w" }),
    );
    // the task moves to a colleague; the department does not change
    const after = resolveDossierAccess(
      base({ userId: "w", roleCodes: TRANSIT_ROLES, currentTaskAssigneeId: "colleague" }),
    );
    expect(before.canViewSummary).toBe(true);
    expect(after.canViewSummary).toBe(true);
    expect(after.canViewCurrentDepartmentDetail).toBe(true);
    // …but the work itself is no longer theirs
    expect(before.canCompleteAssignedTask).toBe(true);
    expect(after.canCompleteAssignedTask).toBe(false);
  });

  it("SYSTEM_ADMIN inspects and reassigns but is NOT an ordinary operator", () => {
    const a = resolveDossierAccess(base({ permissions: ["file:read:all", "admin:config:manage"] }));
    expect(a.canViewSummary).toBe(true);
    expect(a.canViewCurrentDepartmentDetail).toBe(true);
    expect(a.canReassignWithinDepartment).toBe(true);
    // the line that matters
    expect(a.canIntervene).toBe(false);
    expect(a.canCompleteAssignedTask).toBe(false);
  });

  it("a supervisor of the responsible department may reassign and intervene", () => {
    const a = resolveDossierAccess(
      base({ roleCodes: ["CHIEF_OF_TRANSIT", ...TRANSIT_ROLES], supervisorRoles: ["CHIEF_OF_TRANSIT"] }),
    );
    expect(a.canReassignWithinDepartment).toBe(true);
    expect(a.canIntervene).toBe(true);
  });

  it("a supervisor of ANOTHER department may not intervene here", () => {
    const a = resolveDossierAccess(
      base({ roleCodes: ["DAF", ...FINANCE_ROLES], supervisorRoles: ["CHIEF_OF_TRANSIT"] }),
    );
    expect(a.canIntervene).toBe(false);
  });

  it("a driver gains no dossier access from WES-3", () => {
    const a = resolveDossierAccess(base({ roleCodes: ["DRIVER"] }));
    expect(a.canViewSummary).toBe(false);
  });

  it("returns a fully denied shape rather than a partial one", () => {
    const a = resolveDossierAccess(base({ roleCodes: ["HR_OFFICER"] }));
    for (const [key, value] of Object.entries(a)) {
      if (key === "visibilityReason" || key === "reasons") continue;
      expect(value).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// department relation
// ---------------------------------------------------------------------------
describe("WES-3 department relation", () => {
  it("classifies current, previous, future and unrelated", () => {
    expect(departmentRelation(TRANSIT_ROLES, "customs")).toBe("current");
    expect(departmentRelation(OPS_ROLES, "customs")).toBe("previous");
    expect(departmentRelation(FINANCE_ROLES, "customs")).toBe("future");
    expect(departmentRelation(["HR_OFFICER"], "customs")).toBe("unrelated");
  });

  it("treats an unknown responsible department as unrelated, not as open access", () => {
    expect(departmentRelation(TRANSIT_ROLES, null)).toBe("unrelated");
  });
});

// ---------------------------------------------------------------------------
// completion authority
// ---------------------------------------------------------------------------
describe("WES-3B completion authority", () => {
  const assignee = resolveDossierAccess(base({ userId: "w", currentTaskAssigneeId: "w" }));
  const colleague = resolveDossierAccess(base({ userId: "x", roleCodes: TRANSIT_ROLES }));
  const supervisor = resolveDossierAccess(
    base({ roleCodes: ["CHIEF_OF_TRANSIT", ...TRANSIT_ROLES], supervisorRoles: ["CHIEF_OF_TRANSIT"] }),
  );
  const admin = resolveDossierAccess(base({ permissions: ["file:read:all", "admin:config:manage"] }));

  it("the assignee completes their own task", () => {
    expect(mayCompleteWork(assignee, { intervening: false })).toEqual({ ok: true });
  });

  it("an unrelated colleague CANNOT complete it", () => {
    expect(mayCompleteWork(colleague, { intervening: false })).toEqual({
      ok: false,
      error: "not_assigned",
    });
  });

  it("a colleague cannot escalate to intervention without the authority", () => {
    expect(mayCompleteWork(colleague, { intervening: true, reason: "because" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("a supervisor may intervene ONLY with a reason", () => {
    expect(mayCompleteWork(supervisor, { intervening: true, reason: "" })).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect(mayCompleteWork(supervisor, { intervening: true, reason: "absent today" })).toEqual({
      ok: true,
    });
  });

  it("a whitespace-only reason is not a reason", () => {
    expect(mayCompleteWork(supervisor, { intervening: true, reason: "   " })).toEqual({
      ok: false,
      error: "reason_required",
    });
  });

  it("SYSTEM_ADMIN cannot complete someone else's work even with a reason", () => {
    expect(mayCompleteWork(admin, { intervening: true, reason: "cleanup" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("is enforced in completeTask, which previously had NO assignee check", () => {
    const src = code("lib/tasks/actions.ts");
    expect(src).toContain("mayCompleteWork");
    expect(src).toContain("getDossierAccess");
    expect(src).toMatch(/intervening:\s*true/);
  });
});

// ---------------------------------------------------------------------------
// explanations
// ---------------------------------------------------------------------------
describe("WES-3K visibility explanations", () => {
  it("labels every reason in French", () => {
    for (const reason of ACCESS_REASONS) {
      expect(ACCESS_REASON_LABELS_FR[reason].length).toBeGreaterThan(0);
    }
  });

  it("explains access without exposing permission codes", () => {
    const a = resolveDossierAccess(base({ roleCodes: TRANSIT_ROLES }));
    const explained = explainAccessFr(a);
    expect(explained.length).toBeGreaterThan(0);
    for (const line of explained) {
      expect(line).not.toMatch(/:/); // no `file:read:all`-style codes
    }
  });
});

// ---------------------------------------------------------------------------
// WES-3A assignment ledger
// ---------------------------------------------------------------------------
describe("WES-3A assignment ledger", () => {
  it("carries the ratified minimum fields", () => {
    for (const col of [
      "tenant_id", "file_id", "subject_type", "subject_id",
      "previous_user_id", "new_user_id", "actor_user_id", "reason",
      "workflow_step_key", "policy_version_id", "created_at",
    ]) {
      expect(sql()).toContain(col);
    }
  });

  it("supports exactly the four ratified subjects — MISSION belongs to WES-6", () => {
    expect(sql()).toContain("'COMMERCIAL_OWNER', 'OPERATIONAL_OWNER', 'STEP', 'TASK'");
    expect(sql()).not.toContain("'MISSION'");
  });

  it("is append-only for every role", () => {
    expect(sql()).toMatch(/before update on public\.assignment_event[\s\S]*?prevent_mutation/);
    expect(sql()).toMatch(/before delete on public\.assignment_event[\s\S]*?prevent_mutation/);
  });

  it("never lets a cascade erase history", () => {
    const table = sql().slice(
      sql().indexOf("create table public.assignment_event"),
      sql().indexOf("create index idx_assignment_event_file"),
    );
    expect(table).not.toContain("on delete cascade");
    // file_id and subject_id are plain uuids, not FKs to cascading tables
    expect(table).not.toMatch(/file_id\s+uuid\s+references/);
    expect(table).not.toMatch(/subject_id\s+uuid not null references/);
  });

  it("forbids vacating an owner but allows unassigning work", () => {
    expect(sql()).toMatch(/COMMERCIAL_OWNER', 'OPERATIONAL_OWNER'\)\s*\n?\s*and new\.new_user_id is null/);
  });

  it("rejects a no-op assignment", () => {
    expect(sql()).toContain("previous and new assignee are identical");
  });

  it("requires a reason for supervisor and governance decisions, in the DATABASE", () => {
    expect(sql()).toMatch(/SUPERVISOR_INTERVENTION', 'GOVERNANCE'\)/);
    expect(sql()).toContain("a reason is required for");
  });

  it("blocks cross-tenant assignees and actors", () => {
    expect(sql()).toContain("assignee belongs to another tenant");
    expect(sql()).toContain("actor belongs to another tenant");
  });

  it("marks legacy-derived rows honestly instead of fabricating history", () => {
    expect(sql()).toContain("'OBSERVED', 'LEGACY_IMPORT'");
    // No backfill of any kind ships in this migration.
    expect(sql()).not.toMatch(/insert into public\.assignment_event[\s\S]{0,400}from public\.operational_file/i);
  });

  it("is SELECT-only through RLS, following dossier visibility", () => {
    expect(sql()).toContain("alter table public.assignment_event enable row level security");
    expect(sql()).toMatch(/create policy assignment_event_select[\s\S]*?for select to authenticated/);
    expect(sql()).toContain("public.can_read_file(file_id)");
    expect(sql()).not.toMatch(/grant (insert|update|delete) on public\.assignment_event/);
  });

  it("makes an application-side insert unrepresentable", () => {
    const types = code("lib/db/types.ts");
    const block = types.slice(types.indexOf("assignment_event: {"));
    const head = block.slice(0, block.indexOf("Relationships"));
    expect(head).toContain("Insert: never");
    expect(head).toContain("Update: never");
  });
});

// ---------------------------------------------------------------------------
// atomicity
// ---------------------------------------------------------------------------
describe("WES-3A atomicity", () => {
  it("assigns through RPCs, never assignee-then-history", () => {
    for (const fn of ["assign_task", "assign_process_step", "assign_operational_owner"]) {
      expect(sql()).toContain(`create or replace function public.${fn}`);
    }
  });

  it("writes the assignment, the history row and the event in one function body", () => {
    const body = sql().slice(
      sql().indexOf("create or replace function public.assign_task"),
      sql().indexOf("create or replace function public.assign_process_step"),
    );
    expect(body).toContain("update public.task set assigned_to");
    expect(body).toContain("insert into public.assignment_event");
    expect(body).toContain("emit_business_event");
  });

  it("never writes an assignee column directly from application code", () => {
    const src = code("lib/workflow/access/actions.ts");
    expect(src).not.toMatch(/\.from\("task"\)[\s\S]{0,120}\.update\(/);
    expect(src).not.toMatch(/\.from\("process_instance"\)[\s\S]{0,120}\.update\(/);
    expect(src).toContain('supabase.rpc("assign_task"');
  });

  it("does not swallow RPC failures", () => {
    const src = code("lib/workflow/access/actions.ts");
    expect(src).toMatch(/if \(error\) return \{ ok: false/);
  });

  it("maps RPC errors to stable codes instead of leaking Postgres text", () => {
    const src = code("lib/workflow/access/actions.ts");
    expect(src).toContain("function mapRpcError");
    expect(src).toContain('return "assignment_failed"');
  });
});

// ---------------------------------------------------------------------------
// WES-3I business events
// ---------------------------------------------------------------------------
describe("WES-3I assignment events", () => {
  it("declares only the types this phase implements", () => {
    for (const type of [
      "TASK_ASSIGNED", "TASK_REASSIGNED", "TASK_UNASSIGNED",
      "STEP_ASSIGNED", "STEP_REASSIGNED",
      "OPERATIONAL_OWNER_ASSIGNED", "OPERATIONAL_OWNER_REASSIGNED",
    ]) {
      expect(isKnownEventType(type)).toBe(true);
      expect(getEventType(type)?.emission).toBe("rpc");
    }
    // WES-6 territory — not declared.
    expect(isKnownEventType("MISSION_ASSIGNED")).toBe(false);
  });

  it("NEVER carries the free-text reason into the immutable ledger", () => {
    for (const type of ["TASK_ASSIGNED", "TASK_REASSIGNED", "OPERATIONAL_OWNER_REASSIGNED"]) {
      const keys = getEventType(type)?.metadataKeys ?? [];
      expect(keys).not.toContain("reason");
      expect(keys).toContain("reason_code");
      expect(keys).toContain("assignment_event_id");
    }
    // The RPC passes the code and the reference, never p_reason.
    expect(sql()).not.toMatch(/jsonb_build_object\([^)]*'reason',\s*p_reason/);
  });

  it("keeps assignment events off the customer feed", () => {
    for (const type of ["TASK_ASSIGNED", "STEP_REASSIGNED", "OPERATIONAL_OWNER_ASSIGNED"]) {
      expect(getEventType(type)?.clientSafe).toBe(false);
    }
  });

  it("records its own source rather than borrowing another", () => {
    expect(sql()).toContain("'assignment_rpc'");
    expect(sql()).toContain("check (source in ('db_trigger', 'policy_rpc', 'app_action', 'assignment_rpc'))");
  });
});

// ---------------------------------------------------------------------------
// WES-3E / WES-3F — visibility contract and legacy retirement
// ---------------------------------------------------------------------------
describe("WES-3E/3F visibility contract", () => {
  it("adds canonical ownership and step assignment, which were missing", () => {
    const fn = sql().slice(sql().indexOf("create or replace function public.user_readable_file_ids"));
    expect(fn).toContain("pi.owner_user_id = p_user");
    expect(fn).toContain("e.assigned_user_id = p_user");
  });

  it("RETIRES assigned_to_user_id as a visibility source", () => {
    const fn = sql().slice(sql().indexOf("create or replace function public.user_readable_file_ids"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).not.toContain("assigned_to_user_id");
  });

  it("bounds historical access to the append-only ledger", () => {
    const fn = sql().slice(sql().indexOf("create or replace function public.user_readable_file_ids"));
    expect(fn).toContain("from public.assignment_event ae");
  });

  it("keeps tenant isolation intact", () => {
    const fn = sql().slice(sql().indexOf("create or replace function public.user_readable_file_ids"));
    expect(fn).toContain("f.tenant_id = p_tenant");
  });

  it("marks the legacy action deprecated with removal criteria", () => {
    const src = read("lib/files/actions.ts");
    expect(src).toContain("@deprecated WES-3F");
    expect(src).toContain("REMOVAL CRITERIA");
  });

  it("does not copy the legacy value into a canonical field", () => {
    expect(sql()).not.toMatch(/set owner_user_id\s*=\s*[\s\S]{0,40}assigned_to_user_id/i);
    expect(sql()).not.toMatch(/update public\.process_instance[\s\S]{0,200}assigned_to_user_id/i);
  });

  it("does not drop the column during the compatibility window", () => {
    expect(sql()).not.toMatch(/drop column .*assigned_to_user_id/i);
  });
});

// ---------------------------------------------------------------------------
// WES-3J policy consumption
// ---------------------------------------------------------------------------
describe("WES-3J policy consumption", () => {
  it("hardcodes no role list", () => {
    const src = code("lib/workflow/access/eligibility.ts");
    expect(src).not.toMatch(/["'](COORDINATOR|CUSTOMS_DECLARANT|FINANCE_OFFICER)["']/);
    expect(src).toContain("resolvePolicy");
  });

  it("fails closed on every axis", () => {
    expect(isEligibleForSeat({ roles: [], policyVersionId: null, identityBound: false, resolved: false }, ["X"])).toBe(false);
    expect(isEligibleForSeat({ roles: [], policyVersionId: null, identityBound: false, resolved: true }, ["X"])).toBe(false);
    expect(isEligibleForSeat({ roles: ["A"], policyVersionId: null, identityBound: false, resolved: true }, ["X"])).toBe(false);
    expect(isEligibleForSeat({ roles: ["A"], policyVersionId: null, identityBound: true, resolved: true }, ["A"])).toBe(false);
    expect(isEligibleForSeat({ roles: ["A"], policyVersionId: null, identityBound: false, resolved: true }, ["A"])).toBe(true);
  });

  it("resolves the PINNED policy, so a later activation cannot move an open dossier", () => {
    const src = code("lib/workflow/access/eligibility.ts");
    expect(src).toContain("processInstanceId");
    // No independent fallback order — resolvePolicy is the only place it lives.
    expect(src).not.toMatch(/platform.*default.*fallback/i);
  });

  it("refuses assignment when policy cannot be resolved", () => {
    const src = code("lib/workflow/access/actions.ts");
    expect(src).toContain('return { ok: false, error: "policy_unresolved" }');
  });

  it("pins the policy version onto the history row", () => {
    expect(sql()).toContain("policy_version_id");
    const src = code("lib/workflow/access/actions.ts");
    expect(src).toContain("p_policy_id: policyVersionId");
  });
});

// ---------------------------------------------------------------------------
// Repository invariant — UUID literals in SQL fixtures
//
// Lives here because WES-3 is where it bit for the second time. A fixture id
// like '…-00000000p001' looks right, typechecks nowhere, and fails only when
// Postgres parses it — which in this repository means a CI round-trip, since
// there is no local Docker or psql. Worse, the abort SKIPS every later suite,
// so one bad character hides an entire test job. WES-7 lost a round-trip to
// exactly this ('g1', 'wp01', 'w1'); this test makes it impossible to repeat.
// ---------------------------------------------------------------------------
describe("SQL fixtures use valid UUID literals", () => {
  const UUID_SHAPED = /'([0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12})'/g;
  const HEX = /^[0-9a-fA-F-]+$/;

  it("has no non-hex character in any UUID-shaped literal", () => {
    const dirs = ["supabase/tests", "supabase/migrations"];
    const bad: string[] = [];

    for (const dir of dirs) {
      for (const file of readdirSync(join(root, dir))) {
        if (!file.endsWith(".sql")) continue;
        const text = read(join(dir, file));
        for (const m of text.matchAll(UUID_SHAPED)) {
          if (!HEX.test(m[1])) bad.push(`${dir}/${file}: ${m[1]}`);
        }
      }
    }

    expect(bad, `invalid UUID literals:\n${bad.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scope discipline
// ---------------------------------------------------------------------------
describe("WES-3 scope discipline", () => {
  it("does not start WES-4, WES-5, WES-6 or WES-8", () => {
    const all = sql() + code("lib/workflow/access/resolver.ts") + code("lib/workflow/access/actions.ts");
    expect(all).not.toMatch(/create table public\.mission/i);
    expect(all).not.toMatch(/sla_(clock|breach|target_state)/i);
    expect(all).not.toMatch(/bae_governance|evidence_reconciliation/i);
  });

  it("does not change the canonical projection or the progress formula", () => {
    const projection = code("lib/workflow/projection.ts");
    expect(projection).not.toContain("assignment_event");
    expect(projection).not.toContain("resolveDossierAccess");
  });

  it("leaves the driver bridge alone", () => {
    expect(sql()).not.toMatch(/driver/i);
  });
});
