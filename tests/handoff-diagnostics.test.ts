/**
 * UAT-OPS-TRANSIT-00009 — a refusal must say what is missing.
 * ---------------------------------------------------------------------------
 * The pilot dossier could not be transmitted to Transit and the only thing the
 * operator saw was « L'action a échoué. Réessayez. » The guard was right; the
 * diagnostic was not. Two defects sat behind that sentence:
 *
 *   1. the « Processus officiel » screen offered an ENABLED button while the
 *      server would refuse — it knew nothing of the from-step prerequisite;
 *   2. the refusal code the server did return, `am_opening_incomplete`, existed
 *      in no French vocabulary anywhere in the repository.
 *
 * What must never drift again:
 *   * ONE evaluator answers "can this be transmitted", for both screens AND for
 *     the server action — a screen can never be more permissive than the action;
 *   * every prerequisite is listed, not merely the first;
 *   * the first actionable step is DERIVED from the registry dependency graph,
 *     never written for a particular dossier;
 *   * every structured refusal a caller can receive has operator-facing French;
 *   * evidence is named from the document CATALOGUE (type_code), never a filename;
 *   * none of this weakens the guard, the document verification, the ETA rule or
 *     the meaning of BORDEREAU_LIVRAISON.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evaluateTransitHandoffReadiness,
  unmetTransitHandoffPrerequisites,
  firstActionableStepFor,
  TRANSIT_HANDOFF_FROM_STEP,
} from "@/lib/process/intake";
import { getStep, EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const intakeActionsRaw = read("../lib/process/engine/intake-actions.ts");
const intakeActions = strip(intakeActionsRaw);
const engineActions = strip(read("../lib/process/engine/actions.ts"));
const intakeLib = strip(read("../lib/process/intake.ts"));
const panel = strip(read("../components/process/intake-panel.tsx"));
const dossierUi = strip(read("../components/files/transit-handoff.tsx"));
const prereqUi = strip(read("../components/process/handoff-prerequisites.tsx"));
const queueUi = strip(read("../components/process/queue-row-actions.tsx"));
const processPage = strip(read("../app/files/[id]/process/page.tsx"));
const dossierPage = strip(read("../app/files/[id]/page.tsx"));

const fnSlice = (src: string, name: string, end = "\nexport ") => {
  const i = src.indexOf(`export async function ${name}`);
  const rest = src.slice(i);
  const j = rest.indexOf(end, 1);
  return j > 0 ? rest.slice(0, j) : rest;
};
const handoffFn = fnSlice(intakeActions, "handDossierToTransit");

// The 00009 ladder, as production held it: step 1 skipped, step 2 open, the
// rest untouched. Written as data so the assertions read as behaviour.
const LADDER_00009 = [
  { stepKey: "cotation", state: "SKIPPED" },
  { stepKey: "operations_intake", state: "ACTIVE" },
  { stepKey: "am_dossier_opening", state: "PENDING" },
  { stepKey: "coordinator_reception", state: "PENDING" },
];

// ═══════════ one evaluator ═════════════════════════════════════════════════

describe("UAT-00009 — one evaluator answers for every surface", () => {
  it("both screens and the server action read the SAME function", () => {
    expect(processPage).toContain("evaluateTransitHandoffReadiness(");
    expect(dossierPage).toContain("evaluateTransitHandoffReadiness(");
    expect(handoffFn).toContain("evaluateTransitHandoffReadiness(");
  });

  it("neither screen re-implements a prerequisite of its own", () => {
    // The panel used to inspect blocker categories itself; that copy is what
    // let the UI and the server hold different opinions.
    for (const ui of [panel, dossierUi]) {
      expect(ui).not.toContain('category === "MISSING_DOCUMENT"');
      expect(ui).not.toContain("am_dossier_opening");
      expect(ui).not.toContain("isDone(");
    }
  });

  it("the legacy entry point delegates rather than duplicating the rules", () => {
    const legacy = intakeLib.slice(intakeLib.indexOf("export function unmetTransitHandoffPrerequisites"));
    expect(legacy).toContain("evaluateTransitHandoffReadiness(input).unmet");
  });

  it("the evaluator is PURE — no I/O, no client of any kind", () => {
    expect(intakeLib).not.toMatch(/getAdminSupabaseClient|createClient|fetch\(|"use server"/);
  });
});

// ═══════════ the button may not look actionable ════════════════════════════

describe("UAT-00009 — a blocked handoff is not offered", () => {
  it("the process screen gates the button on the evaluator's answer", () => {
    expect(panel).toContain("handoffPrerequisites.length === 0 && (");
  });

  it("the dossier surface still hides its button when blocked", () => {
    expect(dossierUi).toContain("const blocked = prerequisites.length > 0;");
    expect(dossierUi).toContain("{!blocked && (");
  });

  it("both surfaces render the prerequisites through ONE component", () => {
    expect(panel).toContain("<HandoffPrerequisites");
    expect(dossierUi).toContain("<HandoffPrerequisites");
    expect(prereqUi).toContain("Transmission au Transit impossible — prérequis non satisfaits");
  });
});

// ═══════════ every failure, not merely the first ═══════════════════════════

describe("UAT-00009 — all actionable failures are returned together", () => {
  it("three unmet prerequisites yield three sentences", () => {
    const r = evaluateTransitHandoffReadiness({
      hasInstance: true,
      hasOwner: false,
      openBlockers: [{ title: "Facture commerciale manquante", category: "MISSING_DOCUMENT" }],
      amOpeningDone: false,
      steps: LADDER_00009,
    });
    expect(r.unmet.map((u) => u.code)).toEqual([
      "owner_missing",
      "am_opening_incomplete",
      "blocker:MISSING_DOCUMENT",
    ]);
    expect(r.ready).toBe(false);
    for (const u of r.unmet) expect(u.labelFr.length, u.code).toBeGreaterThan(10);
  });

  it("a satisfied dossier yields nothing at all — and no instruction", () => {
    const r = evaluateTransitHandoffReadiness({
      hasInstance: true,
      hasOwner: true,
      openBlockers: [],
      amOpeningDone: true,
      steps: LADDER_00009,
    });
    expect(r.unmet).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.firstActionable).toBeNull();
  });

  it("a non-blocking blocker category still does not block", () => {
    const r = evaluateTransitHandoffReadiness({
      hasInstance: true,
      hasOwner: true,
      openBlockers: [{ title: "Litige fournisseur", category: "PAYMENT" }],
      amOpeningDone: true,
      steps: LADDER_00009,
    });
    expect(r.ready).toBe(true);
  });

  it("the server returns the reasons, not only a code", () => {
    expect(handoffFn).toContain("const reasons = { unmet: readiness.unmet, firstActionable: readiness.firstActionable }");
    expect(handoffFn).toMatch(/error: "am_opening_incomplete",\s*\.\.\.reasons/);
    expect(handoffFn).toMatch(/error: "blocked_by_intake_blockers", blockers,\s*\.\.\.reasons/);
  });

  it("both clients prefer the server's reasons over a mapped code", () => {
    for (const ui of [panel, dossierUi]) {
      expect(ui).toMatch(/unmet && (res|r)\.unmet\.length > 0/);
    }
  });
});

// ═══════════ the first actionable step is derived ══════════════════════════

describe("UAT-00009 — the step to do first comes from the dependency graph", () => {
  it("for the 00009 ladder it resolves to step 2, by walking prerequisites", () => {
    const step = firstActionableStepFor(TRANSIT_HANDOFF_FROM_STEP, LADDER_00009);
    expect(step).not.toBeNull();
    expect(step!.stepKey).toBe("operations_intake");
    expect(step!.stepNumber).toBe(getStep("operations_intake")!.stepNumber);
    expect(step!.labelFr).toBe(getStep("operations_intake")!.labelFr);
  });

  it("once step 2 is done the guidance moves to step 3 — nothing is hard-coded", () => {
    const step = firstActionableStepFor(TRANSIT_HANDOFF_FROM_STEP, [
      { stepKey: "cotation", state: "SKIPPED" },
      { stepKey: "operations_intake", state: "COMPLETED" },
      { stepKey: "am_dossier_opening", state: "AVAILABLE" },
    ]);
    expect(step!.stepKey).toBe("am_dossier_opening");
  });

  it("no step name, number or sentence for 00009 is written in the source", () => {
    for (const src of [intakeLib, prereqUi, panel, dossierUi]) {
      expect(src).not.toMatch(/EFT-IMP-2026-00009|00009/);
      expect(src).not.toContain("Responsable des Opérations — réception et affectation");
    }
    // The label and number are read from the registry, never typed.
    expect(intakeLib).toContain("getStep(TRANSIT_HANDOFF_FROM_STEP)");
    expect(intakeLib).toContain("node.stepNumber");
    expect(intakeLib).toContain("node.labelFr");
  });

  it("guidance is withheld rather than guessed when state is unknown", () => {
    expect(firstActionableStepFor(TRANSIT_HANDOFF_FROM_STEP, [])).toBeNull();
    // Every step outstanding, none actionable (its own prerequisite is open).
    expect(
      firstActionableStepFor("coordinator_reception", [
        { stepKey: "coordinator_reception", state: "PENDING" },
        { stepKey: "am_dossier_opening", state: "PENDING" },
        { stepKey: "operations_intake", state: "PENDING" },
        { stepKey: "cotation", state: "ACTIVE" },
      ])!.stepKey,
    ).toBe("cotation");
  });

  it("a satisfied prerequisite chain proposes nothing", () => {
    expect(
      firstActionableStepFor(TRANSIT_HANDOFF_FROM_STEP, [
        { stepKey: "cotation", state: "SKIPPED" },
        { stepKey: "operations_intake", state: "COMPLETED" },
        { stepKey: "am_dossier_opening", state: "COMPLETED" },
      ]),
    ).toBeNull();
  });

  it("the derived sentences match what the registry says, exactly", () => {
    const s3 = getStep("am_dossier_opening")!;
    const unmet = unmetTransitHandoffPrerequisites({
      hasInstance: true, hasOwner: true, openBlockers: [], amOpeningDone: false,
    });
    expect(unmet[0].labelFr).toBe(`Étape ${s3.stepNumber} « ${s3.labelFr} » : non terminée.`);
  });
});

// ═══════════ the contract: every refusal has French ════════════════════════

describe("UAT-00009 — every structured refusal has operator-facing French", () => {
  /** Error literals a function can actually return, read from its source. */
  const returnedCodes = (fnSource: string): string[] =>
    [...fnSource.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]);

  const engineErrorUnion = (): string[] => {
    const t = strip(read("../lib/process/engine/types.ts"));
    const u = t.slice(t.indexOf("export type EngineError ="));
    return [...u.slice(0, u.indexOf(";")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  };

  const frenchKeys = (ui: string): string[] => {
    const i = ui.indexOf("const ERROR_FR");
    const block = ui.slice(i, ui.indexOf("};", i));
    return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  };

  it("the handoff action's own codes are all spoken on both surfaces", () => {
    const guardCodes = ["engine_disabled", "forbidden"]; // from intakeGuard
    const codes = [...new Set([...returnedCodes(handoffFn), ...guardCodes])];
    expect(codes).toContain("am_opening_incomplete");
    for (const ui of [panel, dossierUi]) {
      const keys = frenchKeys(ui);
      for (const c of codes) expect(keys, `${c} has no French sentence`).toContain(c);
    }
  });

  it("sendHandoff's codes reach the same two surfaces", () => {
    // handDossierToTransit forwards `sent.error` verbatim, so every code
    // sendHandoff can fail with is a code an operator can be shown.
    const send = fnSlice(engineActions, "sendHandoff");
    const codes = [...new Set([...returnedCodes(send), ...(send.match(/fail\("([a-z_]+)"\)/g) ?? [])
      .map((m) => m.replace(/fail\("|"\)/g, ""))])];
    expect(codes).toContain("from_step_incomplete");
    for (const ui of [panel, dossierUi]) {
      const keys = frenchKeys(ui);
      for (const c of codes) expect(keys, `${c} has no French sentence`).toContain(c);
    }
  });

  it("the queue speaks every engine error it can receive", () => {
    const keys = frenchKeys(queueUi);
    for (const c of engineErrorUnion()) {
      expect(keys, `${c} has no French sentence in the queue`).toContain(c);
    }
  });

  it("no surface keeps a French sentence for a code that cannot occur", () => {
    // `feature_disabled` and `cross_tenant_forbidden` were mapped for years
    // while the action returned neither — dead vocabulary hides live gaps.
    for (const ui of [panel, dossierUi]) {
      expect(frenchKeys(ui)).not.toContain("feature_disabled");
      expect(frenchKeys(ui)).not.toContain("cross_tenant_forbidden");
    }
  });

  it("the generic fallback still exists — but is no longer the answer here", () => {
    expect(panel).toContain("L'action a échoué. Réessayez.");
    expect(frenchKeys(panel)).toContain("am_opening_incomplete");
  });
});

// ═══════════ evidence is named, from the catalogue ═════════════════════════

describe("UAT-00009 — a step refusal names the evidence it wants", () => {
  it("submitStep carries the evaluator's items instead of a bare code", () => {
    const s = fnSlice(engineActions, "submitStep");
    expect(s).toContain('failWithEvidence("evidence_missing", ev)');
    expect(engineActions).toContain("const failWithEvidence");
  });

  it("only unsatisfied items are named, and unauthorized ones are withheld", () => {
    const helper = engineActions.slice(engineActions.indexOf("const failWithEvidence"));
    const body = helper.slice(0, helper.indexOf("});"));
    expect(body).toContain('i.status === "missing"');
    expect(body).toContain('i.status === "invalid"');
    expect(body).toContain('i.status === "pending_review"');
    expect(body).not.toContain("unauthorized");
  });

  it("names come from the document catalogue, never from a filename", () => {
    const helper = engineActions.slice(engineActions.indexOf("const failWithEvidence"));
    expect(helper.slice(0, 400)).toContain("labelFr: i.labelFr");
    for (const src of [engineActions, queueUi]) {
      expect(src).not.toMatch(/storage_path|file_name|fileName|originalName/);
    }
  });

  it("the queue renders the named evidence and why it does not count", () => {
    expect(queueUi).toContain("EVIDENCE_STATUS_FR");
    expect(queueUi).toContain("{m.labelFr}");
    expect(queueUi).toContain("r.missing ?? []");
  });
});

// ═══════════ nothing was weakened ══════════════════════════════════════════

describe("UAT-00009 — the guards are untouched", () => {
  it("the D-2 from-step guard still refuses before anything is sent", () => {
    expect(handoffFn).toContain("if (!amOpening || !isDone(amOpening.state))");
    expect(handoffFn.indexOf("am_opening_incomplete")).toBeLessThan(handoffFn.indexOf("sendHandoff("));
  });

  it("the C-2 generic from-step guard is still in sendHandoff", () => {
    expect(engineActions).toContain('if (!from || !isDone(from.state)) return fail("from_step_incomplete");');
  });

  it("blocking-category blockers still abort the transmission", () => {
    expect(handoffFn).toContain("HANDOFF_BLOCKING_CATEGORIES");
    expect(handoffFn.indexOf("blocked_by_intake_blockers")).toBeLessThan(handoffFn.indexOf("sendHandoff("));
  });

  it("document verification is unchanged — an upload is still not an approval", () => {
    const ev = strip(read("../lib/process/engine/evidence.ts"));
    expect(ev).toContain("isVerified(d.status)");
    expect(ev).toContain('if (approvedDoc(snap, typeCode)) return { key, labelFr, status: "satisfied" };');
    expect(ev).toContain('status: "pending_review", detail: "awaiting_approval"');
  });

  it("ETA is still a warning, never a prerequisite", () => {
    expect(intakeLib).toContain('warnings.push(issue("eta_missing"))');
    expect(handoffFn).not.toContain("eta");
    // Every mention of the ETA in the validator is a WARNING push, never a
    // blocking one — a substring ban on "eta" would pass on the warning itself.
    expect(intakeLib).not.toContain('blocking.push(issue("eta_missing"))');
    const etaLines = intakeLib.split(String.fromCharCode(10)).filter((l) => l.includes("eta_missing") && l.includes("push("));
    expect(etaLines.length).toBe(1);
    expect(etaLines[0]).toContain("warnings.push(");
  });

  it("BORDEREAU_LIVRAISON keeps its meaning — no signature was invented", () => {
    const docs = read("../lib/process/documents.ts");
    expect(docs).toContain('labelFr: "Bordereau de Livraison (non signé)"');
    for (const src of [intakeLib, handoffFn, prereqUi, panel, dossierUi]) {
      expect(src).not.toMatch(/signature|signé_requis|requires_signature/i);
    }
    expect(getStep("am_dossier_opening")!.requiredDocuments).toContain("BORDEREAU_LIVRAISON");
  });

  it("the dossier status is not consulted by the handoff — DELIVERED blocks nothing", () => {
    expect(handoffFn).not.toMatch(/file\.status|"DELIVERED"|operational_file"\)[\s\S]{0,80}status/);
  });

  it("no migration was added for this slice", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260928000001_mission_return_leg.sql");
  });

  it("the pilot dossier is named nowhere in the slice", () => {
    for (const src of [intakeActionsRaw, intakeLib, panel, dossierUi, prereqUi, queueUi]) {
      expect(src).not.toMatch(/EFT-IMP-2026-00009/);
    }
  });

  it("the registry itself was not edited to make the UAT pass", () => {
    const step2 = getStep("operations_intake")!;
    const step3 = getStep("am_dossier_opening")!;
    expect(step3.prerequisites).toContain("operations_intake");
    expect(step2.prerequisites).toContain("cotation");
    expect(step3.requiredDocuments).toEqual([
      "TRANSPORT_REQUEST", "BORDEREAU_LIVRAISON", "VENDOR_INVOICE", "SPENDING_AUTHORIZATION",
    ]);
    expect(EFFITRANS_PROCESS.length).toBeGreaterThanOrEqual(26);
  });
});
