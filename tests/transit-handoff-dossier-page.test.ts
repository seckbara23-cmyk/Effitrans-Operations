/**
 * « Transmettre au Transit » on the main dossier page.
 * ---------------------------------------------------------------------------
 * The transition itself is NOT new: `handDossierToTransit` has always been the
 * authoritative Operations→Transit act. What was missing was reach — it existed
 * only on the process screen. These cases pin the four properties the operator
 * required: an unauthorized role cannot transmit, an incomplete dossier cannot
 * transmit, a duplicate transmission is prevented, and a successful one leaves
 * the dossier in Transit's pending-reception state.
 *
 * The authority proofs are read at the SERVER action (the only thing that can
 * actually refuse); the surface proofs are read at the page/component. A UI pin
 * alone would prove nothing — the button is not the boundary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { unmetTransitHandoffPrerequisites, HANDOFF_BLOCKING_CATEGORIES } from "@/lib/process/intake";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const action = read("../lib/process/engine/intake-actions.ts");
const engine = read("../lib/process/engine/actions.ts");
const component = read("../components/files/transit-handoff.tsx");
const page = read("../app/files/[id]/page.tsx");
const panel = read("../components/process/intake-panel.tsx");

/** The `handDossierToTransit` body only — never the whole module. */
function handoffActionSlice(): string {
  const start = action.indexOf("export async function handDossierToTransit");
  expect(start, "handDossierToTransit not found").toBeGreaterThan(-1);
  const next = action.indexOf("\nexport ", start + 1);
  return action.slice(start, next === -1 ? action.length : next);
}

/** The `sendHandoff` body only. */
function sendHandoffSlice(): string {
  const start = engine.indexOf("export async function sendHandoff");
  expect(start, "sendHandoff not found").toBeGreaterThan(-1);
  const next = engine.indexOf("\nexport ", start + 1);
  return engine.slice(start, next === -1 ? engine.length : next);
}

describe("Transit handoff — ONE transition, two surfaces", () => {
  it("the dossier page calls the SAME action as the process screen (no second path)", () => {
    expect(component).toContain('from "@/lib/process/engine/intake-actions"');
    expect(component).toContain("handDossierToTransit(fileId)");
    expect(panel).toContain("handDossierToTransit(fileId)");
    // No re-implementation: the component never touches the engine, the handoff
    // table, or a transition of its own. Asserted on the CODE — the header
    // comment legitimately names `sendHandoff` when explaining what the server
    // does, and a whole-file not.toContain would fail on that prose while
    // proving nothing about behaviour.
    const code = component.slice(component.indexOf("import { useState"));
    for (const forbidden of ["sendHandoff(", "process_handoff", "supabase", 'from("process']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(page).toContain("<TransitHandoff");
  });

  it("an unauthorized role cannot transmit — the SERVER refuses, not the button", () => {
    const s = handoffActionSlice();
    expect(s).toContain('intakeGuard("process:handoff:send"');
    expect(s).toMatch(/const ctx = await intakeGuard\("process:handoff:send", fileId\);\s*\n\s*if \(isErr\(ctx\)\) return \{ ok: false, error: ctx \};/);
    // The guard precedes every read and write in the action.
    expect(s.indexOf("intakeGuard")).toBeLessThan(s.indexOf("sendHandoff"));
    // sendHandoff independently re-guards the same permission.
    expect(sendHandoffSlice()).toContain('guard("process:handoff:send", fileId)');
    // The page hides the control without the permission, but that is cosmetic.
    expect(page).toContain('hasPermission(permissions, "process:handoff:send")');
    expect(component).toContain("if (!canSend) return null;");
  });

  it("an incomplete dossier cannot transmit — server refuses, UI names the reasons", () => {
    const s = handoffActionSlice();
    // Server: blocking-category blockers abort BEFORE any handoff is sent.
    expect(s).toContain("HANDOFF_BLOCKING_CATEGORIES");
    expect(s).toContain('return { ok: false, error: "blocked_by_intake_blockers", blockers };');
    expect(s.indexOf("blocked_by_intake_blockers")).toBeLessThan(s.indexOf("sendHandoff"));
    // …and an un-opened dossier has no instance to hand over.
    expect(s).toContain('if (!snap?.instance) return { ok: false, error: "not_found" };');

    // UI mirror: unopened, owner-less, and blocked dossiers each yield a reason.
    expect(unmetTransitHandoffPrerequisites({ hasInstance: false, hasOwner: false, openBlockers: [] }))
      .toEqual([{ code: "workflow_not_opened", labelFr: expect.stringContaining("ouvert") }]);
    expect(unmetTransitHandoffPrerequisites({ hasInstance: true, hasOwner: false, openBlockers: [] }))
      .toEqual([{ code: "owner_missing", labelFr: expect.stringContaining("responsable") }]);
    for (const category of HANDOFF_BLOCKING_CATEGORIES) {
      const unmet = unmetTransitHandoffPrerequisites({
        hasInstance: true,
        hasOwner: true,
        openBlockers: [{ title: "Facture manquante", category }],
      });
      expect(unmet, category).toEqual([
        { code: `blocker:${category}`, labelFr: "Point bloquant ouvert : Facture manquante" },
      ]);
    }
    // A NON-blocking category does not gate this transmission.
    expect(
      unmetTransitHandoffPrerequisites({
        hasInstance: true,
        hasOwner: true,
        openBlockers: [{ title: "Litige fournisseur", category: "SUPPLIER_ISSUE" }],
      }),
    ).toEqual([]);
    // Ready ⇒ empty ⇒ the component renders the button.
    expect(unmetTransitHandoffPrerequisites({ hasInstance: true, hasOwner: true, openBlockers: [] })).toEqual([]);
    expect(component).toContain("const blocked = prerequisites.length > 0;");
    expect(component).toContain("{!blocked && (");
    expect(component).toContain("Transmission impossible — prérequis non satisfaits");
  });

  it("duplicate transmission is prevented AND idempotent", () => {
    const s = sendHandoffSlice();
    // An already-open handoff returns the SAME id — no second row, no error.
    expect(s).toMatch(/const open = snap\.handoffs\.find\(\s*\(h\) => h\.status === "SENT" && h\.fromStepKey === fromStepKey && h\.toStepKey === toStepKey,\s*\);\s*\n\s*if \(open\) return \{ ok: true, id: open\.id \};/);
    // A concurrent insert that loses the unique race resolves to the winner.
    expect(s).toContain("dedup_key: key");
    expect(s).toContain("// Unique violation => a concurrent send won. Return the existing handoff.");
    // And the surface stops offering the action at all once sent.
    expect(component).toContain("if (handoffSent) {");
    expect(component).toMatch(/if \(handoffSent\) \{[\s\S]{0,600}Dossier transmis au Transit — réception à confirmer/);
  });

  it("a successful transmission leaves Transit's pending-reception state", () => {
    const s = handoffActionSlice();
    // The official pair: AM dossier opening → Coordinator reception.
    expect(s).toContain('sendHandoff(fileId, "am_dossier_opening", "coordinator_reception")');
    // Reception is EXPLICIT and belongs to Transit — it is not implied by sending.
    const transitPanel = read("../components/process/transit-panel.tsx");
    expect(transitPanel).toContain("Réceptionner le dossier");
    expect(transitPanel).toContain("receiveDossierAtTransit(fileId)");
    expect(transitPanel).toContain("En attente de réception par le Transit.");
    // The dossier page states the same thing to the sender.
    expect(component).toContain("Le Transit doit « Réceptionner le dossier » avant de commencer son exécution.");
  });

  it("records actor, timestamp, source and destination department, and the transition", () => {
    const s = sendHandoffSlice();
    expect(s).toContain("action: AuditActions.PROCESS_HANDOFF_SENT");
    expect(s).toContain("actorId: c.userId");
    expect(s).toMatch(/after: \{[\s\S]{0,220}from: fromStepKey,[\s\S]{0,220}to: toStepKey,[\s\S]{0,220}from_department: nodeDepartment\(fromStepKey\),[\s\S]{0,220}to_department: nodeDepartment\(toStepKey\),/);
    expect(engine).toContain("function nodeDepartment(stepKey: string): string | null {");
  });

  it("does NOT touch client ownership — a departmental handoff moves no seat", () => {
    for (const forbidden of [
      "account_manager_id",
      "assign_commercial_owner",
      "assignCommercialOwner",
      "commercial_owner",
    ]) {
      expect(handoffActionSlice(), forbidden).not.toContain(forbidden);
      expect(component, forbidden).not.toContain(forbidden);
    }
    // The commercial-owner panel remains the only mover of that seat.
    expect(page).toContain("<CommercialOwner");
  });
});
