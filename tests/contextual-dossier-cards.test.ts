/**
 * OPS-CUSTOMS-GAINDE-04 slice 6 — the official process, where the work is.
 * ---------------------------------------------------------------------------
 * Operators were navigating from a dossier to the 26-step page and back to
 * perform work belonging to the section they were already reading. The steps
 * that concern them now appear beside that section.
 *
 * THE INVARIANT THIS FILE EXISTS FOR. It is not a second workflow. Same process
 * state, same server action, same permission, same owning role, same assignment,
 * same claimant rule, same evidence, same handoff, same audit, same transition —
 * whether invoked from `/files/[id]/process` or from `/files/[id]`. The card
 * decides nothing; it renders a verdict the server computed with the evaluator
 * every other surface reads.
 *
 * A UI test cannot prove that. What it CAN prove, and what these assertions
 * hold, is that there is no second path to prove wrong: no client-side authority,
 * no fetch, no second evaluator, no second assignment door, and no button drawn
 * on anything but `StepEligibility`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { STEP_SECTION, sectionFor } from "@/lib/process/contextual/sections";
import { contextualStatus, worthShowing } from "@/lib/process/contextual/view";
import type { StepEligibility } from "@/lib/process/step-eligibility";

/**
 * Every node the engine materialises an execution row for. The three parallel
 * activities (BAD, Pre-Gate, transport docs) carry no step NUMBER but are
 * genuinely executable — every journey activates them — so a placement map
 * that covered only the numbered 26 would leave three steps invisible on the
 * dossier, which looks exactly like three steps that do not exist.
 */
const ALL_NODES = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CARD = "components/process/contextual-step-card.tsx";
const CARDS = "lib/process/contextual/cards.ts";
const DOSSIER = "app/files/[id]/page.tsx";
const PROCESS = "app/files/[id]/process/page.tsx";

/** A verdict, so the view helpers can be exercised without a database. */
const verdict = (over: Partial<StepEligibility> = {}): StepEligibility => ({
  permission: "customs:update",
  mayAct: true,
  isOwner: true,
  claimedByAnother: false,
  custody: "not_applicable",
  awaitingReception: false,
  notApplicable: null,
  unauthorized: false,
  requirements: [],
  canStart: false,
  canSubmit: false,
  reasonFr: null,
  ...over,
});

// ===========================================================================
// NOT A SECOND WORKFLOW
// ===========================================================================

describe("the dossier card is a surface, never an engine", () => {
  it("01 — it calls the SAME component the official-process page mounts", () => {
    // Reused rather than reimplemented: a second copy of the buttons is how two
    // surfaces start offering different things on the same verdict.
    expect(code(CARD)).toContain('import { StepActions } from "./step-actions"');
    expect(code(CARD)).toContain("<StepActions");
  });

  it("02 — which calls the same two server actions, and nothing else", () => {
    const actions = code("components/process/step-actions.tsx");
    expect(actions).toMatch(/queueStartStep\([^)]*fileId[^)]*stepKey/);
    expect(actions).toMatch(/queueSubmitStep\([^)]*fileId[^)]*stepKey/);
    expect(actions).not.toMatch(/fetch\s*\(/);
  });

  it("03 — the card derives no authority of its own", () => {
    const card = code(CARD);
    for (const forbidden of [
      "hasPermission",
      "assertPermission",
      "getAdminSupabaseClient",
      "fetch(",
      "evaluateStepAction",
      "process_step_execution",
    ]) {
      expect(card, forbidden).not.toContain(forbidden);
    }
  });

  it("04 — every condition it renders comes from the server's verdict", () => {
    const card = code(CARD);
    expect(card).toContain("eligibility.requirements");
    // No state of its own beyond what a transition needs — which lives in
    // StepActions, not here.
    expect(card).not.toContain("useState");
  });

  it("05 — Affecter, Démarrer and Terminer are never collapsed into one button", () => {
    // Three governance acts, three authorities, three audit rows.
    const actions = code("components/process/step-actions.tsx");
    expect(actions).toContain("Démarrer");
    expect(actions).toContain("Terminer");
    expect(actions).not.toMatch(/Avancer|Faire avancer|advance/i);
    expect(code(CARD)).not.toMatch(/Avancer|advance/i);
  });

  it("06 — and no assignment door was invented: the weak lane stays unused", () => {
    // `assignStepToUser` and `assignOperationalOwner` write no audit row and
    // perform no dossier-visibility check. Neither becomes the dossier's
    // assignment path in this slice.
    for (const p of [CARD, CARDS, DOSSIER]) {
      expect(code(p), p).not.toContain("assignStepToUser");
      expect(code(p), p).not.toContain("assignOperationalOwner");
    }
  });
});

// ===========================================================================
// THE SERVER HALF
// ===========================================================================

describe("the cards are assembled from the one loader and the one evaluator", () => {
  it("07 — through the shared model, not a query and not a second evaluation", () => {
    // OPS-NEXT-ACTION-01 moved the load one hop further away, and the
    // invariant is STRONGER for it: the cards no longer load anything and no
    // longer evaluate anything. They are projected from the canonical work
    // model, built once per request by `getDossierWork` over the one loader,
    // so the cards, the dossier header and the journey panel are not merely
    // consistent — they are literally the same verdicts.
    const cards = code(CARDS);
    expect(cards).toContain("getDossierWork(");
    expect(cards).not.toContain("getAdminSupabaseClient");
    expect(cards).not.toContain(".select(");
    expect(cards).not.toContain("evaluateStepAction(");
    const service = code("lib/process/work-service.ts");
    expect(service).toContain("loadContextualStepFacts(");
    expect(service).toContain("evaluateStepAction(");
  });

  it("08 — and the dossier page mounts them without deciding anything", () => {
    const page = code(DOSSIER);
    expect(page).toContain("getDossierWork(");
    expect(page).toContain("cardsFromWork(file.id, workView)");
    expect(page).toContain("<ContextualStepCard");
    // The page passes the reader's OWN permissions and roles — a widened set
    // would make the evidence snapshot lie about what they can see.
    expect(page).toMatch(/permissions,\s*roles: user\.roles \?\? \[\],/);
    // ONE build. Two calls would put two opinions on one page, which is the
    // defect this programme exists to end — between pages first, and now
    // within one.
    expect(page.match(/getDossierWork\(/g) ?? []).toHaveLength(1);
  });

  it("09 — a dossier with no process instance renders exactly as before", () => {
    // The compatibility path every process surface keeps: nothing appears, and
    // no section changes.
    expect(code(CARDS)).toContain("if (!view?.hasInstance) return {};");
  });
});

// ===========================================================================
// PLACEMENT
// ===========================================================================

describe("every step has a home, and the homes are the dossier's own sections", () => {
  it("10 — every registry node is placed", () => {
    // An unplaced step would simply never appear, which looks exactly like a
    // step that does not exist.
    const unplaced = ALL_NODES.map((s) => s.key).filter((k) => !sectionFor(k));
    expect(unplaced, `unplaced: ${unplaced.join(", ")}`).toEqual([]);
  });

  it("11 — and nothing is placed that the registry does not define", () => {
    const keys = new Set(ALL_NODES.map((s) => s.key));
    for (const k of Object.keys(STEP_SECTION)) {
      expect(keys.has(k), `${k} is not a registry step`).toBe(true);
    }
  });

  it("12 — the customs lane sits with Dédouanement, including Finance's step 9", () => {
    // Ratified 2026-09-06: Finance's customs operation and downstream
    // Facturation are distinct, and the officer performing step 9 is reading
    // the Dédouanement section.
    for (const k of [
      "customs_preparation",
      "transit_validation",
      "gainde_registration",
      "gainde_document_submission",
      "customs_field_clearance",
    ]) {
      expect(sectionFor(k), k).toBe("customs");
    }
    expect(sectionFor("billing_draft")).toBe("finance");
  });

  it("13 — each section is mounted on the dossier page exactly once", () => {
    const page = read(DOSSIER);
    for (const section of ["operations", "commercial", "coordination", "customs", "transport", "delivery", "finance"]) {
      const n = (page.match(new RegExp(`cards\\("${section}"\\)\\.length`, "g")) ?? []).length;
      expect(n, section).toBe(1);
    }
  });

  it("14 — and the module-gated sections stay behind their read permission", () => {
    const page = read(DOSSIER);
    expect(page).toContain('{canReadCustoms && cards("customs").length > 0 && (');
    expect(page).toContain('{canReadTransport && cards("transport").length > 0 && (');
    expect(page).toContain('{canReadFinance && cards("finance").length > 0 && (');
  });
});

// ===========================================================================
// WHAT AN OPERATOR READS
// ===========================================================================

describe("the ratified status vocabulary, and no colour-only meaning", () => {
  it("15 — a step this reader can act on says « À votre tour »", () => {
    expect(contextualStatus("AVAILABLE", verdict({ canStart: true })).labelFr).toBe("À votre tour");
    expect(contextualStatus("ACTIVE", verdict({ canSubmit: true })).labelFr).toBe("À votre tour");
  });

  it("16 — PENDING is « En attente », never « Terminée »", () => {
    // UI-1 in its status form: the confusion that made untouched work read as
    // finished.
    expect(contextualStatus("PENDING", verdict()).labelFr).toBe("En attente");
    expect(contextualStatus("COMPLETED", verdict()).labelFr).toBe("Terminée");
  });

  it("17 — held by somebody else reads « En cours », not as an error", () => {
    expect(contextualStatus("ACTIVE", verdict({ claimedByAnother: true })).labelFr).toBe("En cours");
  });

  it("18 — a refusal the platform can name reads « Bloquée »", () => {
    expect(contextualStatus("AVAILABLE", verdict({ reasonFr: "Prérequis manquants" })).labelFr)
      .toBe("Bloquée");
    expect(contextualStatus("AVAILABLE", verdict()).labelFr).toBe("Disponible");
  });

  it("19 — every status carries a WORD, so colour is never the only carrier", () => {
    for (const state of ["PENDING", "AVAILABLE", "ACTIVE", "BLOCKED", "COMPLETED", "SKIPPED", "REJECTED"]) {
      const s = contextualStatus(state, verdict());
      expect(s.labelFr.length, state).toBeGreaterThan(3);
      expect(s.tone, state).toContain("text-");
    }
  });

  it("20 — no internal code ever reaches the card", () => {
    for (const state of ["PENDING", "AVAILABLE", "ACTIVE", "BLOCKED", "COMPLETED"]) {
      const s = contextualStatus(state, verdict());
      expect(s.labelFr, state).not.toMatch(/[a-z]+_[a-z]+/);
    }
    const card = code(CARD);
    for (const leak of ["step_closed", "assigned_to_another", "evidence_missing", "step_gate_"]) {
      expect(card, leak).not.toContain(leak);
    }
  });
});

describe("contextual means what concerns you, not the whole process again", () => {
  it("21 — finished, skipped and not-yet-open steps are not repeated on the dossier", () => {
    for (const state of ["COMPLETED", "APPROVED", "SKIPPED", "CANCELLED", "PENDING"]) {
      expect(worthShowing(state, verdict()), state).toBe(false);
    }
  });

  it("22 — but anything actionable is always shown, whatever its state", () => {
    for (const state of ["AVAILABLE", "ACTIVE"]) {
      expect(worthShowing(state, verdict({ canStart: true })), state).toBe(true);
    }
  });

  it("23 — and an open step that is refused is shown WITH its reason, not hidden", () => {
    // A silent absence is the defect this programme started from: the operator
    // could not tell « not yours » from « broken ».
    expect(worthShowing("AVAILABLE", verdict({ isOwner: false, mayAct: false, reasonFr: "Cette étape relève d'un autre rôle." })))
      .toBe(true);
  });

  it("24 — a step that is nobody's business here is not drawn at all", () => {
    expect(worthShowing("AVAILABLE", verdict({ isOwner: false, mayAct: false, reasonFr: null }))).toBe(false);
  });
});

// ===========================================================================
// DEEP LINKS
// ===========================================================================

describe("deep links target a stable step, never a DOM position", () => {
  it("25 — the official-process page anchors each row on its step KEY", () => {
    const page = read(PROCESS);
    expect(page).toContain("id={`step-${s.stepKey}`}");
    expect(page).toContain("scroll-mt-24");
  });

  it("26 — and the loader builds the link from the same key", () => {
    expect(code("lib/process/contextual/facts.ts"))
      .toContain("anchor: `/files/${fileId}/process#step-${e.stepKey}`");
  });

  it("27 — the card offers both « cette étape » and « le processus complet »", () => {
    const card = read(CARD);
    expect(card).toContain("Voir cette étape");
    expect(card).toContain("Voir le processus complet");
    expect(card).toContain("href={anchor}");
    expect(card).toContain("href={`/files/${fileId}/process`}");
  });

  it("28 — /process keeps everything it had: nothing was removed from it", () => {
    const page = code(PROCESS);
    for (const kept of ["<StepActions", "<IntakePanel", "<TransitPanel", "<FinancePanel", "<CommercialOwner"]) {
      expect(page, kept).toContain(kept);
    }
  });
});
