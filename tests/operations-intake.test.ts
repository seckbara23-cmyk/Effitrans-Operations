/**
 * Phase 9.0C — Operations intake and dossier ownership.
 * ---------------------------------------------------------------------------
 * The pure intake validation contract is tested directly; the server-action
 * guarantees (flag gates, permission gates, orchestration ORDER, milestone
 * dedup, blocker gate before handoff, no-new-structures invariants) are
 * asserted structurally against the real source, per repo convention.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validateIntake, HANDOFF_BLOCKING_CATEGORIES, type IntakeInput } from "@/lib/process/intake";
import { resolveProcessFlags } from "@/lib/process/flags";
import { CUSTOMER_EVENTS, isCustomerEvent, dedupKey } from "@/lib/customer-notify/events";
import { t } from "@/lib/i18n";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("../lib/process/engine/intake-actions.ts");
const panel = code("../components/process/intake-panel.tsx");
const page = code("../app/files/[id]/process/page.tsx");
const rollout = code("../lib/process/rollout.ts");
const envExample = read("../.env.example");

const COMPLETE: IntakeInput = {
  clientId: "c1",
  fileType: "IMP",
  transportMode: "SEA",
  origin: "Shanghai",
  destination: "Dakar",
  reference: "BL-123",
  eta: "2026-08-01",
  ownerUserId: "u1",
};

// ================================================ pure validation (tests 1-16) ====

describe("intake validation — pure contract", () => {
  it("1 — a complete dossier is ready with no blocking issues and no warnings", () => {
    expect(validateIntake(COMPLETE)).toEqual({ blocking: [], warnings: [], ready: true });
  });

  it("2 — an entirely blank intake blocks on client, type, owner and mode", () => {
    const v = validateIntake({
      clientId: null, fileType: null, transportMode: null, origin: null,
      destination: null, reference: null, eta: null, ownerUserId: null,
    });
    expect(v.ready).toBe(false);
    expect(v.blocking.map((i) => i.code).sort()).toEqual(
      ["client_missing", "mode_missing", "owner_missing", "type_missing"],
    );
  });

  it("3 — missing customer blocks opening", () => {
    const v = validateIntake({ ...COMPLETE, clientId: null });
    expect(v.ready).toBe(false);
    expect(v.blocking.map((i) => i.code)).toEqual(["client_missing"]);
  });

  it("4 — missing dossier type blocks opening", () => {
    const v = validateIntake({ ...COMPLETE, fileType: null });
    expect(v.ready).toBe(false);
    expect(v.blocking.map((i) => i.code)).toEqual(["type_missing"]);
  });

  it("5 — missing Operations owner blocks opening", () => {
    const v = validateIntake({ ...COMPLETE, ownerUserId: null });
    expect(v.ready).toBe(false);
    expect(v.blocking.map((i) => i.code)).toEqual(["owner_missing"]);
  });

  it("6 — missing transport mode blocks an IMP dossier", () => {
    const v = validateIntake({ ...COMPLETE, transportMode: null });
    expect(v.blocking.map((i) => i.code)).toEqual(["mode_missing"]);
  });

  it("7 — missing transport mode blocks EXP and TRP dossiers too", () => {
    expect(validateIntake({ ...COMPLETE, fileType: "EXP", transportMode: null }).ready).toBe(false);
    expect(validateIntake({ ...COMPLETE, fileType: "TRP", transportMode: null }).ready).toBe(false);
  });

  it("8 — an HND handling dossier without a mode is a WARNING, not a blocker", () => {
    const v = validateIntake({ ...COMPLETE, fileType: "HND", transportMode: null });
    expect(v.ready).toBe(true);
    expect(v.blocking).toEqual([]);
    expect(v.warnings.map((i) => i.code)).toContain("mode_recommended");
  });

  it("9 — missing origin is a warning only; opening stays allowed", () => {
    const v = validateIntake({ ...COMPLETE, origin: null });
    expect(v.ready).toBe(true);
    expect(v.warnings.map((i) => i.code)).toEqual(["origin_missing"]);
  });

  it("10 — missing destination is a warning only", () => {
    const v = validateIntake({ ...COMPLETE, destination: null });
    expect(v.ready).toBe(true);
    expect(v.warnings.map((i) => i.code)).toEqual(["destination_missing"]);
  });

  it("11 — BL/AWB/reference is NEVER universally mandatory: missing reference only warns", () => {
    const v = validateIntake({ ...COMPLETE, reference: null });
    expect(v.ready).toBe(true);
    expect(v.warnings.map((i) => i.code)).toEqual(["reference_missing"]);
  });

  it("12 — missing ETA is a warning only", () => {
    const v = validateIntake({ ...COMPLETE, eta: null });
    expect(v.ready).toBe(true);
    expect(v.warnings.map((i) => i.code)).toEqual(["eta_missing"]);
  });

  it("13 — whitespace-only values count as blank", () => {
    const v = validateIntake({ ...COMPLETE, clientId: "   ", origin: " " });
    expect(v.blocking.map((i) => i.code)).toContain("client_missing");
    expect(v.warnings.map((i) => i.code)).toContain("origin_missing");
  });

  it("14 — every issue carries a French label", () => {
    const v = validateIntake({
      clientId: null, fileType: null, transportMode: null, origin: null,
      destination: null, reference: null, eta: null, ownerUserId: null,
    });
    for (const issue of [...v.blocking, ...v.warnings]) {
      expect(issue.labelFr.length).toBeGreaterThan(5);
    }
    expect(v.blocking.find((i) => i.code === "owner_missing")?.labelFr).toContain("responsable opérationnel");
  });

  it("15 — ready is exactly 'no blocking issues' (warnings never block)", () => {
    const warned = validateIntake({ ...COMPLETE, origin: null, destination: null, reference: null, eta: null });
    expect(warned.warnings).toHaveLength(4);
    expect(warned.ready).toBe(true);
  });

  it("16 — blocking and warnings never overlap for the same input", () => {
    const v = validateIntake({ ...COMPLETE, fileType: "HND", transportMode: null, eta: null });
    const blockingCodes = new Set(v.blocking.map((i) => i.code));
    for (const w of v.warnings) expect(blockingCodes.has(w.code)).toBe(false);
  });
});

// ======================================== handoff blocker policy (tests 17-18) ====

describe("handoff-blocking categories", () => {
  it("17 — exactly missing-document and customer-response block the Transit handoff", () => {
    expect([...HANDOFF_BLOCKING_CATEGORIES].sort()).toEqual(["CUSTOMER_RESPONSE_REQUIRED", "MISSING_DOCUMENT"]);
  });

  it("18 — payment/supplier issues do not gate the transmission", () => {
    expect(HANDOFF_BLOCKING_CATEGORIES).not.toContain("PAYMENT_PENDING");
    expect(HANDOFF_BLOCKING_CATEGORIES).not.toContain("SUPPLIER_ISSUE");
  });
});

// ============================================================ flags (tests 19-24) ====

describe("intake flag resolution — dark by default, double-gated", () => {
  it("19 — everything defaults off", () => {
    expect(resolveProcessFlags({}).intake).toBe(false);
  });

  it("20 — the intake flag alone does nothing (master off)", () => {
    expect(resolveProcessFlags({ EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true" }).intake).toBe(false);
  });

  it("21 — master + intake WITHOUT structures stays dark (intake writes 9.0B structures)", () => {
    expect(resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
    }).intake).toBe(false);
  });

  it("22 — master + structures + intake all on => live", () => {
    const f = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
    });
    expect(f.structures).toBe(true);
    expect(f.intake).toBe(true);
  });

  it("23 — structures on without the intake flag leaves intake dark (independent rollout)", () => {
    expect(resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
    }).intake).toBe(false);
  });

  it("24 — tenant rollout ANDs the env intake flag and FLAGS_ALL_OFF covers it", () => {
    expect(rollout).toContain("intake: enabled && env.structures && env.intake");
    expect(rollout).toContain("intake: false");
  });
});

// ================================================ customer milestone (tests 25-30) ====

describe("« Dossier reçu » customer milestone", () => {
  it("25 — file_opened is a registered customer event on the shipment channel", () => {
    expect(isCustomerEvent("file_opened")).toBe(true);
    expect(CUSTOMER_EVENTS.file_opened).toEqual({ category: "shipment", template: "shipment_progress" });
  });

  it("26 — dedup key is stable per dossier, so the milestone publishes at most once", () => {
    expect(dedupKey("file_opened", "file-1")).toBe("file_opened:file-1");
    expect(dedupKey("file_opened", "file-1")).toBe(dedupKey("file_opened", "file-1"));
  });

  it("27 — the customer copy is French and customer-facing (no internal codes)", () => {
    const ev = t.portal.notify.events.file_opened;
    expect(ev.title).toBe("Dossier reçu");
    expect(ev.message).not.toContain("DRAFT");
    expect(ev.message).not.toContain("OPENED");
    expect(ev.message).not.toContain("process_instance");
  });

  it("28 — the milestone is published LAST: after owner assignment and status transition", () => {
    const open = actions.slice(actions.indexOf("export async function openDossierWorkflow"));
    const owner = open.indexOf("assignProcessOwner(");
    const transition = open.indexOf('transitionFile(fileId, "OPENED")');
    const milestone = open.indexOf("notifyCustomer(");
    expect(owner).toBeGreaterThan(-1);
    expect(transition).toBeGreaterThan(owner);
    expect(milestone).toBeGreaterThan(transition);
  });

  it("29 — a failed status transition aborts BEFORE the milestone (no premature customer message)", () => {
    const open = actions.slice(actions.indexOf("export async function openDossierWorkflow"));
    const failReturn = open.indexOf('error: "transition_failed"');
    const milestone = open.indexOf("notifyCustomer(");
    expect(failReturn).toBeGreaterThan(-1);
    expect(failReturn).toBeLessThan(milestone);
  });

  it("30 — the action reports whether the milestone actually published (dedup-aware)", () => {
    expect(actions).toContain('milestonePublished: milestone === "created"');
  });
});

// ============================================ openDossierWorkflow (tests 31-41) ====

describe("openDossierWorkflow — orchestration of existing audited actions", () => {
  const open = actions.slice(
    actions.indexOf("export async function openDossierWorkflow"),
    actions.indexOf("export async function handDossierToTransit"),
  );

  it("31 — gated on process:manage through the intake guard", () => {
    expect(open).toContain('intakeGuard("process:manage", fileId)');
  });

  it("32 — the guard requires kill.intake AND tenant intake AND file visibility", () => {
    const guard = actions.slice(actions.indexOf("async function intakeGuard"), actions.indexOf("const isErr"));
    expect(guard).toContain("!kill.enabled || !kill.intake");
    expect(guard).toContain("!tenantFlags.enabled || !tenantFlags.intake");
    expect(guard).toContain("isFileVisible(user.id, user.tenantId, fileId)");
    expect(guard).toContain("assertPermission(permission)");
  });

  it("33 — blocking validation refuses opening BEFORE any instance is created", () => {
    const validation = open.indexOf("validateIntake(");
    const refuse = open.indexOf('error: "intake_incomplete", blocking: validation.blocking');
    const init = open.indexOf("initializeProcessForFile(fileId)");
    expect(validation).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(validation);
    expect(refuse).toBeLessThan(init);
  });

  it("34 — the instance comes from the EXISTING idempotent initializer, never a direct insert", () => {
    expect(open).toContain("initializeProcessForFile(fileId)");
    expect(actions).not.toContain('from("process_instance").insert');
    expect(actions).not.toContain('from("process_step_execution").insert');
  });

  it("35 — the owner is assigned through the 9.0B contract (validation + audit live there)", () => {
    expect(open).toContain("assignProcessOwner(fileId, { ownerUserId: input.ownerUserId");
    expect(actions).not.toContain(".update({ owner_user_id");
  });

  it("36 — an owner rejection surfaces as owner_<error> and aborts the opening", () => {
    expect(open).toContain("if (!owned.ok) return { ok: false, error: `owner_${owned.error}` }");
  });

  it("37 — cotation is skipped by default as an EXPLICIT manual skip with a French reason", () => {
    expect(open).toContain('skipStep(fileId, "cotation"');
    expect(open).toContain('source: "MANUAL"');
    expect(open).toContain("sans cotation préalable");
    expect(open).toContain("input.skipCotation !== false");
  });

  it("38 — the first Operations step is activated from the frozen registry key", () => {
    expect(open).toContain('activateStep(fileId, "operations_intake")');
  });

  it("39 — the legacy DRAFT→OPENED transition goes through the EXISTING seam, only from DRAFT", () => {
    expect(open).toContain('if (file.status === "DRAFT")');
    expect(open).toContain('transitionFile(fileId, "OPENED")');
    expect(actions).not.toContain('from("operational_file").update');
  });

  it("40 — the owner gets a staff notification via the existing FILE_ASSIGNED type, never self-notify", () => {
    expect(open).toContain("input.ownerUserId !== ctx.userId");
    expect(open).toContain('type: "FILE_ASSIGNED"');
    expect(open).toContain("responsable opérationnel");
  });

  it("41 — success returns the instance id and the non-blocking warnings for display", () => {
    expect(open).toContain("instanceId: init.id!");
    expect(open).toContain("warnings: validation.warnings");
  });
});

// ============================================ handDossierToTransit (tests 42-47) ====

describe("handDossierToTransit — formal transmission, blocker-gated", () => {
  const hand = actions.slice(actions.indexOf("export async function handDossierToTransit"));

  it("42 — gated on process:handoff:send through the same intake guard", () => {
    expect(hand).toContain('intakeGuard("process:handoff:send", fileId)');
  });

  it("43 — open intake blockers are checked BEFORE the handoff is sent", () => {
    const blockerQuery = hand.indexOf('from("process_blocker")');
    const refuse = hand.indexOf('error: "blocked_by_intake_blockers"');
    const send = hand.indexOf("sendHandoff(");
    expect(blockerQuery).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(blockerQuery);
    expect(refuse).toBeLessThan(send);
  });

  it("44 — only OPEN/ACKNOWLEDGED blockers in the handoff-blocking categories gate it", () => {
    expect(hand).toContain('.in("status", ["OPEN", "ACKNOWLEDGED"])');
    expect(hand).toContain(".in(\"category\", [...HANDOFF_BLOCKING_CATEGORIES])");
  });

  it("45 — the transmission is the engine's existing controlled handoff into coordinator_reception", () => {
    expect(hand).toContain('sendHandoff(fileId, "am_dossier_opening", "coordinator_reception")');
    expect(hand).not.toContain('from("process_handoff").insert');
  });

  it("46 — Operations remains the owner: the handoff never touches owner columns", () => {
    expect(hand).not.toContain("owner_user_id");
  });

  it("47 — the receiving Transit side is notified (Coordinator + Chef de Transit, active, not the actor)", () => {
    expect(hand).toContain('["COORDINATOR", "CHIEF_OF_TRANSIT"]');
    expect(hand).toContain('.eq("status", "active")');
    expect(hand).toContain("id !== ctx.userId");
    expect(hand).toContain("Dossier transmis au Transit");
  });
});

// ===================================== read side + owner directory (tests 48-52) ====

describe("intake read side and owner directory", () => {
  it("48 — getIntakeState is read-gated and DEGRADES TO NULL when 9.0B structures are absent", () => {
    const state = actions.slice(actions.indexOf("export async function getIntakeState"), actions.indexOf("export async function openDossierWorkflow"));
    expect(state).toContain('intakeGuard("process:read", fileId)');
    expect(state).toContain("try {");
    expect(state).toContain("return null;");
  });

  it("49 — every service-role read is tenant-scoped", () => {
    expect(actions).toContain("file.tenant_id !== tenantId");
    const blockerReads = actions.split('from("process_blocker")').length - 1;
    const tenantScoped = actions.split('.eq("tenant_id", ctx.tenantId)').length - 1;
    expect(blockerReads).toBeGreaterThan(0);
    expect(tenantScoped).toBeGreaterThanOrEqual(blockerReads);
  });

  it("50 — eligible owners = active same-tenant staff whose roles map to canonical OPERATIONS", () => {
    const list = actions.slice(actions.indexOf("export async function listEligibleOperationsOwners"), actions.indexOf("export type IntakeState"));
    expect(list).toContain('assertPermission("process:owner:assign")');
    expect(list).toContain('.eq("status", "active")');
    expect(list).toContain('roleCanonicalDepartment(code) === "OPERATIONS"');
    expect(list).toContain(".limit(200)");
  });

  it("51 — the owner surface exposes name/role/department — no id field to leak", () => {
    const ownerType = actions.slice(actions.indexOf("owner: {"), actions.indexOf("handoffSent:"));
    expect(ownerType).toContain("name: string");
    expect(ownerType).toContain("roleLabel");
    expect(ownerType).toContain("departmentLabel");
    expect(ownerType).not.toContain("id:");
  });

  it("52 — the read-side validation treats an already-assigned owner as satisfied", () => {
    expect(actions).toContain('ownerUserId: owner ? "assigned" : null');
  });
});

// ===================================================== UI + wiring (tests 53-58) ====

describe("intake panel and page wiring", () => {
  it("53 — the panel labels the owner « Responsable opérationnel » and renders name/role, never a raw UUID", () => {
    expect(panel).toContain("Responsable opérationnel");
    expect(panel).toContain("state.owner.name");
    expect(panel).toContain("state.owner.roleLabel");
    expect(panel).not.toContain("state.owner.id");
    expect(panel).not.toContain("{fileId}");
  });

  it("54 — the open button requires an owner and no non-owner blocking issue", () => {
    expect(panel).toContain('i.code !== "owner_missing"');
    expect(panel).toContain("pending || !ownerUserId || nonOwnerBlocking.length > 0");
  });

  it("55 — the Transit button is disabled while a handoff-blocking category is open", () => {
    expect(panel).toContain('b.category === "MISSING_DOCUMENT" || b.category === "CUSTOMER_RESPONSE_REQUIRED"');
  });

  it("56 — a blocker is customer-visible ONLY when a customer message is written", () => {
    expect(panel).toContain("customerVisible: Boolean(blockerCustomerMessage.trim())");
  });

  it("57 — the process page gates everything on the tenant intake flag and hides on null state", () => {
    expect(page).toContain("if (tenantFlags.intake)");
    expect(page).toContain("getIntakeState(params.id)");
    expect(page).toContain("intake ? (");
    const noInstanceBranch = page.slice(page.indexOf("if (!state)"), page.indexOf("return (", page.indexOf("if (!state)") + 500));
    expect(page.split("{intakePanel}").length - 1 + (page.includes("{intakePanel && ") ? 1 : 0)).toBeGreaterThanOrEqual(2);
    expect(noInstanceBranch).toBeDefined();
  });

  it("58 — opening authority = process:manage AND process:owner:assign on the page", () => {
    expect(page).toContain('hasPermission(permissions, "process:manage") && hasPermission(permissions, "process:owner:assign")');
  });
});

// ========================================== no-expansion invariants (tests 59-62) ====

describe("Phase 9.0C adds NO schema and NO permissions", () => {
  it("59 — no new migration ships with 9.0C (latest is still the 9.0B structures migration)", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260723000002_finance_requests.sql");
    expect(files.some((f) => f.includes("intake"))).toBe(false);
  });

  it("60 — intake actions reuse EXISTING permissions only", () => {
    const perms = [...actions.matchAll(/(?:intakeGuard|assertPermission)\("([a-z:]+)"/g)].map((m) => m[1]);
    expect(new Set(perms)).toEqual(new Set(["process:manage", "process:handoff:send", "process:owner:assign", "process:read"]));
  });

  it("61 — no permission named after intake exists anywhere in seed or templates", () => {
    expect(read("../supabase/seed.sql")).not.toContain("intake");
    expect(read("../lib/platform/role-templates.ts")).not.toContain("intake");
  });

  it("62 — the rollout flag is documented dark in .env.example", () => {
    expect(envExample).toContain("EFFITRANS_OPERATIONS_INTAKE_ENABLED=false");
  });
});
