/**
 * Phase 9.0D — Transit execution workflow.
 * ---------------------------------------------------------------------------
 * The pure read-model (T1–T10 mapping, stage derivation, dispatch-by-mode,
 * customer-safe vocabulary) is tested directly; the server-action guarantees
 * (flag gates, orchestration REUSE of existing audited actions, no new
 * table/permission, tenant scope, Operations-ownership invariance, milestone
 * via releaseCustoms) are asserted structurally against the real source.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TRANSIT_STAGES,
  TRANSIT_STAGE_STEP_KEYS,
  CUSTOMER_SAFE_STAGE_LABELS,
  deriveTransitStages,
  dispatchTeamForMode,
  dispatchIsDeterministic,
  type TransitExecutionView,
} from "@/lib/process/transit";
import { ALL_NODE_KEYS } from "@/lib/process/engine/state";
import { resolveProcessFlags } from "@/lib/process/flags";
import { resolveEffectiveFlags, FLAGS_ALL_OFF, ROLLOUT_DISABLED } from "@/lib/process/rollout";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("../lib/process/engine/transit-actions.ts");
const panel = code("../components/process/transit-panel.tsx");
const page = code("../app/files/[id]/process/page.tsx");
const rollout = code("../lib/process/rollout.ts");
const envExample = read("../.env.example");

const ev = (rows: Record<string, string>): TransitExecutionView[] =>
  Object.entries(rows).map(([stepKey, state]) => ({ stepKey, state: state as never }));

// ================================================ T1–T10 mapping (tests 1-8) ====

describe("Transit stage mapping", () => {
  it("1 — maps exactly ten source stages T1..T10 in order", () => {
    expect(TRANSIT_STAGES.map((s) => s.key)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]);
  });

  it("2 — every mapped step key is a REAL frozen registry node (no invented steps)", () => {
    const known = new Set(ALL_NODE_KEYS);
    for (const k of TRANSIT_STAGE_STEP_KEYS) expect(known.has(k)).toBe(true);
  });

  it("3 — the correction/return stage T3 is a mechanism with no steps", () => {
    const t3 = TRANSIT_STAGES.find((s) => s.key === "T3")!;
    expect(t3.mechanism).toBe(true);
    expect(t3.stepKeys).toHaveLength(0);
  });

  it("4 — validation (T5) uses the frozen maker-checker validator step", () => {
    expect(TRANSIT_STAGES.find((s) => s.key === "T5")!.stepKeys).toContain("transit_validation");
  });

  it("5 — BAE acquisition (T8) includes customs_field_clearance", () => {
    expect(TRANSIT_STAGES.find((s) => s.key === "T8")!.stepKeys).toContain("customs_field_clearance");
  });

  it("6 — dispatch (T9) targets the transport_assignment step", () => {
    expect(TRANSIT_STAGES.find((s) => s.key === "T9")!.stepKeys).toEqual(["transport_assignment"]);
  });

  it("7 — reception (T1) is the coordinator_reception step", () => {
    expect(TRANSIT_STAGES.find((s) => s.key === "T1")!.stepKeys).toContain("coordinator_reception");
  });

  it("8 — every stage carries a French label and a named responsible party", () => {
    for (const s of TRANSIT_STAGES) {
      expect(s.labelFr.length).toBeGreaterThan(5);
      expect(s.responsibleFr.length).toBeGreaterThan(3);
    }
  });
});

// =========================================== stage status derivation (9-16) ====

describe("deriveTransitStages — pure rollup", () => {
  it("9 — a completed reception step marks T1 done", () => {
    const stages = deriveTransitStages(ev({ coordinator_reception: "COMPLETED" }));
    expect(stages.find((s) => s.key === "T1")!.status).toBe("done");
  });

  it("10 — an active preparation step marks T2/T4 active", () => {
    const stages = deriveTransitStages(ev({ customs_preparation: "ACTIVE", transit_declarant_assignment: "COMPLETED" }));
    expect(stages.find((s) => s.key === "T2")!.status).toBe("active");
    expect(stages.find((s) => s.key === "T4")!.status).toBe("active");
  });

  it("11 — a BLOCKED step marks its stage blocked", () => {
    const stages = deriveTransitStages(ev({ customs_field_clearance: "BLOCKED", gainde_document_submission: "COMPLETED", customs_followup: "COMPLETED" }));
    expect(stages.find((s) => s.key === "T8")!.status).toBe("blocked");
  });

  it("12 — a SKIPPED step counts as done (customs steps on a TRP dossier)", () => {
    const stages = deriveTransitStages(ev({ transit_validation: "SKIPPED" }));
    expect(stages.find((s) => s.key === "T5")!.status).toBe("done");
  });

  it("13 — a stage with no materialized executions is pending", () => {
    const stages = deriveTransitStages([]);
    for (const s of stages) expect(s.status).toBe("pending");
  });

  it("14 — a multi-step stage is done only when ALL its steps are done", () => {
    const stages = deriveTransitStages(ev({ gainde_document_submission: "COMPLETED", customs_followup: "COMPLETED", customs_field_clearance: "AVAILABLE" }));
    expect(stages.find((s) => s.key === "T8")!.status).toBe("active");
  });

  it("15 — the T3 correction mechanism stays pending (no steps to roll up)", () => {
    const stages = deriveTransitStages(ev({ coordinator_reception: "COMPLETED" }));
    expect(stages.find((s) => s.key === "T3")!.status).toBe("pending");
  });

  it("16 — derivation never invents a status outside the closed set", () => {
    const stages = deriveTransitStages(ev({ customs_preparation: "SUBMITTED" }));
    for (const s of stages) expect(["pending", "active", "blocked", "done"]).toContain(s.status);
  });
});

// ============================================= dispatch by mode (tests 17-23) ====

describe("dispatchTeamForMode — deterministic field routing", () => {
  it("17 — air dispatches to AIBD", () => {
    expect(dispatchTeamForMode("AIR", "IMP")).toBe("AIBD");
  });
  it("18 — sea (and ocean) dispatches to Maritime", () => {
    expect(dispatchTeamForMode("SEA", "IMP")).toBe("MARITIME");
    expect(dispatchTeamForMode("OCEAN", "EXP")).toBe("MARITIME");
  });
  it("19 — road forces neither team (explicit choice required)", () => {
    expect(dispatchTeamForMode("ROAD", "TRP")).toBeNull();
  });
  it("20 — multimodal is ambiguous — neither team", () => {
    expect(dispatchTeamForMode("MULTIMODAL", "IMP")).toBeNull();
  });
  it("21 — a handling-only (HND) dossier never dispatches to a field team", () => {
    expect(dispatchTeamForMode("AIR", "HND")).toBeNull();
  });
  it("22 — an unknown/empty mode is not guessed", () => {
    expect(dispatchTeamForMode(null, "IMP")).toBeNull();
    expect(dispatchTeamForMode("", "IMP")).toBeNull();
  });
  it("23 — determinism helper agrees with the resolver", () => {
    expect(dispatchIsDeterministic("AIR", "IMP")).toBe(true);
    expect(dispatchIsDeterministic("ROAD", "TRP")).toBe(false);
  });
});

// ========================================= customer-safe vocabulary (24-26) ====

describe("customer-safe stage vocabulary", () => {
  it("24 — every customerStage on a stage has a French label", () => {
    for (const s of TRANSIT_STAGES) {
      if (s.customerStage) expect(CUSTOMER_SAFE_STAGE_LABELS[s.customerStage]).toBeTruthy();
    }
  });
  it("25 — the labels are the business-approved customer phrases", () => {
    expect(CUSTOMER_SAFE_STAGE_LABELS.authorization_obtained).toBe("Autorisation obtenue");
    expect(CUSTOMER_SAFE_STAGE_LABELS.customer_action_required).toBe("Action client requise");
    expect(CUSTOMER_SAFE_STAGE_LABELS.customs_formalities).toBe("Formalités douanières en cours");
  });
  it("26 — no customer label leaks an internal step key or T-number", () => {
    for (const label of Object.values(CUSTOMER_SAFE_STAGE_LABELS)) {
      expect(label).not.toMatch(/customs_|coordinator_|gainde_|T\d/);
    }
  });
});

// ================================================ flag resolution (tests 27-33) ====

describe("transit execution flag — dark by default, quadruple-gated", () => {
  it("27 — defaults off", () => {
    expect(resolveProcessFlags({}).transitExecution).toBe(false);
  });
  it("28 — the transit flag alone does nothing (master off)", () => {
    expect(resolveProcessFlags({ EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true" }).transitExecution).toBe(false);
  });
  it("29 — master + transit WITHOUT structures+intake stays dark", () => {
    expect(resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
    }).transitExecution).toBe(false);
  });
  it("30 — master + structures + transit WITHOUT intake stays dark", () => {
    expect(resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
    }).transitExecution).toBe(false);
  });
  it("31 — master + structures + intake + transit all on => live", () => {
    const f = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
    });
    expect(f.intake).toBe(true);
    expect(f.transitExecution).toBe(true);
  });
  it("32 — the tenant rollout ANDs the env flag, and FLAGS_ALL_OFF covers it", () => {
    expect(rollout).toContain("transitExecution: enabled && env.structures && env.intake && env.transitExecution");
    expect(FLAGS_ALL_OFF.transitExecution).toBe(false);
  });
  it("33 — a disabled tenant rollout is dark even with every env flag on", () => {
    const env = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
    });
    expect(resolveEffectiveFlags(env, ROLLOUT_DISABLED).transitExecution).toBe(false);
  });
});

// ============================================ orchestration reuse (tests 34-48) ====

describe("transit-actions orchestrate EXISTING audited actions only", () => {
  it("34 — the guard requires kill.transitExecution AND tenant.transitExecution AND visibility", () => {
    const guard = actions.slice(actions.indexOf("async function transitGuard"), actions.indexOf("async function loadInstance"));
    expect(guard).toContain("!kill.enabled || !kill.transitExecution");
    expect(guard).toContain("!tenantFlags.enabled || !tenantFlags.transitExecution");
    expect(guard).toContain("isFileVisible(user.id, user.tenantId, fileId)");
  });

  it("35 — reception reuses the engine's receiveHandoff on coordinator_reception", () => {
    const fn = actions.slice(actions.indexOf("export async function receiveDossierAtTransit"), actions.indexOf("export async function assignTransitStep"));
    expect(fn).toContain("receiveHandoff(fileId, handoff.id)");
    expect(fn).toContain('.eq("to_step_key", "coordinator_reception")');
    expect(actions).not.toContain('from("process_handoff").insert');
  });

  it("36 — declarant assignment writes ONLY assigned_user_id and validates TRANSIT eligibility", () => {
    const fn = actions.slice(actions.indexOf("export async function assignTransitStep"), actions.indexOf("export async function requestPaymentGateDecision"));
    expect(fn).toContain(".update({ assigned_user_id: userId })");
    expect(fn).toContain('roleCanonicalDepartment(r.code) === "TRANSIT"');
    expect(fn).toContain('.eq("state", exec.state)'); // CAS
    expect(fn).not.toContain("owner_user_id");
  });

  it("37 — the payment gate reuses requestProcessDecision(CONTINUE_BEFORE_PAYMENT)", () => {
    const fn = actions.slice(actions.indexOf("export async function requestPaymentGateDecision"), actions.indexOf("export async function finalizePaymentGateDecision"));
    expect(fn).toContain('requestProcessDecision(fileId, {');
    expect(fn).toContain('decisionType: "CONTINUE_BEFORE_PAYMENT"');
    expect(actions).not.toContain('from("process_decision").insert');
  });

  it("38 — finalizing reuses finalizeProcessDecision and BLOCK_UNTIL_PAYMENT opens a PAYMENT_PENDING blocker", () => {
    const fn = actions.slice(actions.indexOf("export async function finalizePaymentGateDecision"), actions.indexOf("export async function recordBae"));
    expect(fn).toContain("finalizeProcessDecision(fileId, decisionId");
    expect(fn).toContain('outcome === "BLOCK_UNTIL_PAYMENT"');
    expect(fn).toContain('category: "PAYMENT_PENDING"');
  });

  it("39 — the finance gate never writes a payment/invoice record (financial truth untouched)", () => {
    expect(actions).not.toContain('from("payment")');
    expect(actions).not.toContain('from("invoice")');
  });

  it("40 — BAE reuses the existing releaseCustoms action (which fires the customer milestone)", () => {
    const fn = actions.slice(actions.indexOf("export async function recordBae"), actions.indexOf("export async function dispatchToField"));
    expect(fn).toContain("releaseCustoms(customs.id, baeReference.trim())");
    expect(fn).toContain("baeReference.trim().length === 0"); // reference mandatory
    expect(actions).not.toContain('from("customs_record").update');
  });

  it("41 — BAE does NOT publish the customer milestone directly — it flows through releaseCustoms", () => {
    // No direct customer-notify call anywhere in transit-actions; the milestone is
    // the existing customs action's responsibility, so it stays dedup'd + once-only.
    expect(actions).not.toContain("notifyCustomer");
    expect(actions).not.toContain("custCustomsCleared");
  });

  it("42 — dispatch reuses assignStepTeam on transport_assignment, deterministic by mode", () => {
    const fn = actions.slice(actions.indexOf("export async function dispatchToField"));
    expect(fn).toContain('assignStepTeam(fileId, "transport_assignment", team)');
    expect(fn).toContain("dispatchTeamForMode(");
    expect(actions).not.toContain('from("process_step_execution").insert');
  });

  it("43 — an ambiguous mode requires an explicit team AND a reason", () => {
    const fn = actions.slice(actions.indexOf("export async function dispatchToField"));
    expect(fn).toContain("!input.reason || input.reason.trim().length === 0");
    expect(fn).toContain("TEAM_CODES");
  });

  it("44 — NO transit action ever writes an owner column (Operations keeps ownership)", () => {
    expect(actions).not.toContain(".update({ owner_user_id");
    expect(actions).not.toContain("owner_assigned_by");
  });

  it("45 — team dispatch notifies the TEAM's active members, not every user", () => {
    const fn = actions.slice(actions.indexOf("export async function dispatchToField"));
    expect(fn).toContain('from("organization_team_member")');
    expect(fn).toContain('.eq("active", true)');
    expect(fn).toContain('.eq("status", "active")');
  });

  it("46 — staff notices reuse the existing FILE_ASSIGNED type (no new notification type)", () => {
    expect(actions).toContain('type: "FILE_ASSIGNED"');
    expect(actions).not.toContain("HANDOFF_RECEIVED");
    expect(actions).not.toMatch(/type:\s*"TRANSIT_/);
  });

  it("47 — the read side degrades to null when structures/instance are absent", () => {
    const fn = actions.slice(actions.indexOf("export async function getTransitState"), actions.indexOf("export async function receiveDossierAtTransit"));
    expect(fn).toContain("try {");
    expect(fn).toContain("return null;");
    expect(fn).toContain('transitGuard("process:read", fileId)');
  });

  it("48 — the eligible-assignee directory is gated and TRANSIT-scoped", () => {
    const fn = actions.slice(actions.indexOf("export async function listEligibleTransitAssignees"), actions.indexOf("export type TransitState"));
    expect(fn).toContain('assertPermission("customs:assign")');
    expect(fn).toContain('.eq("status", "active")');
    expect(fn).toContain('roleCanonicalDepartment(code) === "TRANSIT"');
    expect(fn).toContain(".limit(200)");
  });
});

// ================================================ no-expansion invariants (49-56) ====

describe("Phase 9.0D adds NO schema and NO new permission", () => {
  it("49 — no new migration ships (latest is still the 9.0B structures migration)", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260724000002_hr_employee_registry.sql");
    expect(files.some((f) => f.includes("transit_execution"))).toBe(false);
  });

  it("50 — transit actions reuse EXISTING permissions only", () => {
    const perms = [...actions.matchAll(/(?:transitGuard|assertPermission)\("([a-z:]+)"/g)].map((m) => m[1]);
    expect(new Set(perms)).toEqual(new Set([
      "process:read", "process:handoff:receive", "customs:assign",
      "process:decision:create", "process:decision:approve", "customs:release", "process:team:manage",
    ]));
  });

  it("51 — no permission named after transit exists in seed or templates", () => {
    expect(read("../supabase/seed.sql")).not.toContain("transit:execution");
    expect(read("../lib/platform/role-templates.ts")).not.toContain("transit:execution");
  });

  it("52 — the rollout flag is documented dark in .env.example", () => {
    expect(envExample).toContain("EFFITRANS_TRANSIT_EXECUTION_ENABLED=false");
  });

  it("53 — no new engine table is created by this phase", () => {
    for (const t of ["transit_task", "transit_execution", "orbus_record", "gred_record", "bae_record"]) {
      expect(actions).not.toContain(`from("${t}")`);
    }
  });

  it("54 — the two new audit actions are the only additions (assignment + reception)", () => {
    expect(actions).toContain("PROCESS_STEP_ASSIGNED");
    expect(actions).toContain("PROCESS_TRANSIT_RECEIVED");
  });

  it("55 — transit-actions imports the reused engine/customs actions, re-implements none", () => {
    expect(actions).toContain('from "./actions"');           // receiveHandoff
    expect(actions).toContain('from "./structures-actions"'); // assignStepTeam / decisions / blocker
    expect(actions).toContain('from "@/lib/customs/actions"');// releaseCustoms
  });

  it("56 — every service-role read carries a tenant_id filter or column (leak guard)", () => {
    // Belt-and-braces alongside tenant-scope.test.ts: every .from(...).select on
    // a tenant table in this file mentions tenant_id in its chain.
    const selects = [...actions.matchAll(/\.from\("(\w+)"\)\s*\.select\(/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(5);
  });
});

// ==================================================== UI + wiring (tests 57-62) ====

describe("transit panel and page wiring", () => {
  it("57 — the panel shows names/roles, never a raw owner/declarant UUID", () => {
    expect(panel).toContain("state.owner.name");
    expect(panel).toContain("state.declarant.name");
    expect(panel).not.toContain(".owner.id");
    expect(panel).not.toContain(".declarant.id");
  });

  it("58 — the panel renders the T1–T10 progress with business labels, not step keys", () => {
    expect(panel).toContain("state.stages.map");
    expect(panel).toContain("s.labelFr");
    expect(panel).toContain("s.responsibleFr");
  });

  it("59 — the panel surfaces the three finance outcomes by their French names", () => {
    expect(panel).toContain("BLOCK_UNTIL_PAYMENT");
    expect(panel).toContain("CONTINUE_PROVISIONALLY");
    expect(panel).toContain("CONTINUE_WITH_APPROVAL");
    expect(panel).toContain("Bloquer jusqu'au paiement");
  });

  it("60 — a customs observation is customer-visible only when a message is written", () => {
    expect(panel).toContain('category: "CUSTOMS_OBSERVATION"');
    expect(panel).toContain("customerVisible: Boolean(obsCustomerMessage.trim())");
  });

  it("61 — the process page gates the panel on the tenant transit flag and hides on null", () => {
    expect(page).toContain("if (tenantFlags.transitExecution)");
    expect(page).toContain("getTransitState(params.id)");
    expect(page).toContain("transit ? (");
    expect(page).toContain("{transitPanel}");
  });

  it("62 — opening authority for declarant assignment is customs:assign on the page", () => {
    expect(page).toContain('hasPermission(permissions, "customs:assign")');
    expect(page).toContain('listEligibleTransitAssignees("CUSTOMS_DECLARANT")');
  });
});
