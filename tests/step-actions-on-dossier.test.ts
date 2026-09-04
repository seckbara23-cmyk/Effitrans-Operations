/**
 * UAT-WF-STEP3-001 — an official step is performed where the dossier is.
 * ---------------------------------------------------------------------------
 * An Account Manager opened EFT-IMP-2026-00010, found step 3 AVAILABLE on the
 * official-process page, and had no way to perform it. The capability existed
 * and was fully governed — `activateStep` then `submitStep` — but it lived only
 * in `/queues/account_management`, and nothing on the dossier pointed there.
 * Systemic, not step-3-specific: every purely engine-owned step had the same
 * shape.
 *
 * The fix is one derivation, two surfaces:
 *
 *   evaluateStepAction(facts, viewer)  ← lib/process/step-eligibility.ts
 *        ├── /queues/[queueKey]        (QueueItem.eligibility)
 *        └── /files/[id]/process       (StepActions)
 *
 * What must never drift:
 *   * both surfaces read that ONE function — no surface re-derives conditions;
 *   * both call the SAME server actions; no second mutation path exists;
 *   * AVAILABLE is never directly completable — a step is claimed, then done;
 *   * a step claimed by someone else offers no completion to anyone else;
 *   * an outstanding handoff blocks execution on every surface;
 *   * hiding a button is never the boundary — the engine still refuses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateStepAction } from "@/lib/process/step-eligibility";
import { stepPermission, canTransitionStep } from "@/lib/process/engine/state";
import { queueForStep } from "@/lib/process/queues/registry";
import { getStep } from "@/lib/process/effitrans-process";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NL = String.fromCharCode(10);

const eligibility = strip(read("lib/process/step-eligibility.ts"));
const queueService = strip(read("lib/process/queues/service.ts"));
const queueRow = strip(read("components/process/queue-row-actions.tsx"));
const stepActions = strip(read("components/process/step-actions.tsx"));
const processPage = strip(read("app/files/[id]/process/page.tsx"));
const engineActions = strip(read("lib/process/engine/actions.ts"));
const queueActions = strip(read("lib/process/queues/actions.ts"));

const AM = { userId: "user-am", permissions: ["file:create", "process:read"] };
const OTHER_AM = { userId: "user-am-2", permissions: ["file:create", "process:read"] };
const SUPERVISOR = { userId: "user-ops", permissions: ["file:assign", "file:update", "process:read"] };

const step3 = (over: Partial<Parameters<typeof evaluateStepAction>[0]> = {}) => ({
  stepKey: "am_dossier_opening",
  state: "AVAILABLE",
  assignedUserId: null,
  awaitingReception: false,
  ...over,
});

// ═══════════ the eligibility rules themselves ══════════════════════════════

describe("UAT-WF-STEP3-001 — one derivation decides what a surface offers", () => {
  it("AVAILABLE + eligible caller → Démarrer, and only Démarrer", () => {
    const el = evaluateStepAction(step3(), AM);
    expect(el.canStart).toBe(true);
    expect(el.canSubmit).toBe(false);
    expect(el.permission).toBe("file:create");
  });

  it("AVAILABLE + wrong role → nothing offered, and it says why", () => {
    const el = evaluateStepAction(step3(), SUPERVISOR);
    expect(el.mayAct).toBe(false);
    expect(el.canStart).toBe(false);
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toBe("Cette étape relève d'un autre rôle.");
  });

  it("ACTIVE + owning caller → Terminer", () => {
    const el = evaluateStepAction(step3({ state: "ACTIVE", assignedUserId: AM.userId }), AM);
    expect(el.canSubmit).toBe(true);
    expect(el.canStart).toBe(false);
    expect(el.claimedByAnother).toBe(false);
  });

  it("ACTIVE claimed by ANOTHER holder of the same permission → no completion", () => {
    // The case the ruling names: a colleague — or a supervisor who happened to
    // hold the permission — must not finish somebody else's attestation.
    const el = evaluateStepAction(step3({ state: "ACTIVE", assignedUserId: AM.userId }), OTHER_AM);
    expect(el.mayAct).toBe(true);
    expect(el.claimedByAnother).toBe(true);
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toBe("Étape déjà prise en charge par une autre personne.");
  });

  it("an outstanding handoff blocks execution, whoever is looking", () => {
    for (const viewer of [AM, OTHER_AM, SUPERVISOR]) {
      const el = evaluateStepAction(step3({ awaitingReception: true }), viewer);
      expect(el.canStart, "start").toBe(false);
      expect(el.canSubmit, "submit").toBe(false);
    }
    expect(evaluateStepAction(step3({ awaitingReception: true }), AM).reasonFr)
      .toBe("Le transfert doit d'abord être réceptionné.");
  });

  it("an unmet prerequisite is a reason, not a silent absence", () => {
    const el = evaluateStepAction(step3({ blockedReason: "Prérequis manquants : cotation" }), AM);
    expect(el.canStart).toBe(false);
    expect(el.reasonFr).toBe("Prérequis manquants : cotation");
  });

  it.each(["PENDING", "BLOCKED", "SUBMITTED", "COMPLETED", "SKIPPED", "CANCELLED"])(
    "%s offers no execution action at all",
    (state) => {
      const el = evaluateStepAction(step3({ state }), AM);
      expect(el.canStart).toBe(false);
      expect(el.canSubmit).toBe(false);
    },
  );

  it("AVAILABLE can never be completed directly — the engine forbids the jump", () => {
    expect(canTransitionStep("AVAILABLE", "COMPLETED")).toBe(false);
    expect(canTransitionStep("AVAILABLE", "ACTIVE")).toBe(true);
    expect(canTransitionStep("ACTIVE", "COMPLETED")).toBe(true);
    // …and the model never offers submit on AVAILABLE, for anyone.
    for (const viewer of [AM, OTHER_AM, SUPERVISOR]) {
      expect(evaluateStepAction(step3(), viewer).canSubmit).toBe(false);
    }
  });

  it("the permission is the engine's own, per step — never hard-coded", () => {
    expect(eligibility).toContain("stepPermission(facts.stepKey)");
    for (const key of ["am_dossier_opening", "operations_intake", "customs_preparation", "pickup"]) {
      expect(evaluateStepAction(step3({ stepKey: key }), AM).permission).toBe(stepPermission(key));
    }
  });

  it("the module is PURE — it reads no database and is no second engine", () => {
    expect(eligibility).not.toMatch(/getAdminSupabaseClient|createClient|"use server"|from\(/);
    expect(eligibility).not.toMatch(/process_step_execution|\.update\(|\.insert\(/);
  });
});

// ═══════════ both surfaces read the SAME function ══════════════════════════

describe("UAT-WF-STEP3-001 — one model, two surfaces", () => {
  it("the queue derives eligibility from the shared function", () => {
    expect(queueService).toContain("evaluateStepAction(");
    expect(queueService).toContain("eligibility: evaluateStepAction(");
  });

  it("the dossier's official-process page derives it from the same function", () => {
    expect(processPage).toContain("evaluateStepAction(");
    expect(processPage).toContain('from "@/lib/process/step-eligibility"');
  });

  it("neither surface re-implements the conditions locally", () => {
    for (const [name, src] of [["queue row", queueRow], ["step actions", stepActions]] as const) {
      expect(src, name).not.toContain("stepPermission(");
      expect(src, name).not.toContain("hasPermission(");
      expect(src, name).not.toMatch(/assignedUserId|assigned_user_id/);
    }
    // The row reads the verdict; it does not rebuild it.
    expect(queueRow).toContain("const el = item.eligibility;");
    // Each button is gated by the shared verdict AT ITS OWN RENDER SITE. A
    // substring check passes on a mere mention elsewhere in the file, which is
    // how a probe replaced one gate with `true` and survived.
    expect(stepActions).toMatch(/\{eligibility\.canStart && \(/);
    expect(stepActions).toMatch(/\{eligibility\.canSubmit && \(/);
  });

  it("the page passes the ENGINE's facts, not its own opinion of them", () => {
    expect(processPage).toContain("assignedUserId: s.assignedUserId");
    expect(processPage).toContain("awaitingReception: pendingHandoffTargets.has(s.stepKey)");
    // The page now reads SENT *and* RECEIVED, because custody needs both:
    // « nothing transmitted » and « transmitted, not accepted » are different
    // facts requiring different acts (UAT-WF-HANDOFF-01B).
    expect(processPage).toContain('.in("status", ["SENT", "RECEIVED"])');
    expect(processPage).toContain('if (h.status === "SENT") pendingHandoffTargets.add(h.to_step_key);');
  });
});

// ═══════════ no second mutation path ═══════════════════════════════════════

describe("UAT-WF-STEP3-001 — the same engine, called the same way", () => {
  it("both surfaces call the SAME two server actions, at the call site", () => {
    // Asserted as CALLS, not as imports: leaving the import while swapping the
    // call for a fetch is exactly the second mutation path this forbids.
    for (const [name, src] of [["queue row", queueRow], ["step actions", stepActions]] as const) {
      expect(src, name).toMatch(/queueStartStep\([^)]*fileId[^)]*stepKey/);
      expect(src, name).toMatch(/queueSubmitStep\([^)]*fileId[^)]*stepKey/);
      expect(src, name).not.toMatch(/fetch\s*\(/);
      expect(src, name).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    }
  });

  it("the wrappers delegate to activateStep / submitStep and nothing else", () => {
    expect(queueActions).toContain("await activateStep(fileId, stepKey)");
    expect(queueActions).toContain("await submitStep(fileId, stepKey)");
  });

  it("no UI writes process_step_execution directly", () => {
    for (const [name, src] of [["queue row", queueRow], ["step actions", stepActions], ["page", processPage]] as const) {
      expect(src, name).not.toContain("process_step_execution");
    }
  });

  it("the page's own reads are reads — it mutates nothing", () => {
    const block = processPage.slice(processPage.indexOf("const pendingHandoffTargets"));
    const body = block.slice(0, block.indexOf("return ("));
    expect(body).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
  });
});

// ═══════════ the server remains the boundary ═══════════════════════════════

describe("UAT-WF-STEP3-001 — nothing was weakened", () => {
  it("activateStep still checks permission, prerequisites and reception", () => {
    const fn = engineActions.slice(engineActions.indexOf("export async function activateStep"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("guard(stepPermission(stepKey), fileId)");
    expect(body).toContain('if (!prerequisitesMet(stepKey, views)) return fail("prerequisites_unmet")');
    // The custody question widened (UAT-WF-HANDOFF-01B) and moved into
    // `custodyRefusal`: refused while a transfer is outstanding AND when a
    // governed route was never transmitted at all.
    expect(body).toContain("custodyRefusal(stepKey, st.snapshot!.handoffs)");
  });

  it("submitStep still checks permission, reception, evidence and legality", () => {
    const fn = engineActions.slice(engineActions.indexOf("export async function submitStep"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("guard(stepPermission(stepKey), fileId)");
    expect(body).toContain("custodyRefusal(stepKey, st.snapshot!.handoffs)");
    expect(body).toContain('failWithEvidence("evidence_missing", ev)');
    expect(body).toContain('if (!canTransitionStep(st.state, target)) return fail("invalid_state")');
  });

  it("step 3 remains an explicit Account Manager attestation", () => {
    // Evidence unchanged, ownership unchanged, and no fact may close it.
    expect(getStep("am_dossier_opening")!.requiredDocuments).toEqual([]);
    expect(getStep("am_dossier_opening")!.permissions[0]).toBe("file:create");
    expect(FACT_RULES["am_dossier_opening"]).toBeUndefined();
  });

  it("every active step resolves to a queue, so the page can always route the action", () => {
    for (const key of ["operations_intake", "am_dossier_opening", "coordinator_reception",
                       "customs_preparation", "gainde_registration", "pickup"]) {
      expect(queueForStep(key), key).not.toBeNull();
    }
  });

  it("the domain panels are untouched and still server-guarded", () => {
    expect(strip(read("lib/process/engine/transit-actions.ts"))).toContain("transitGuard(");
    expect(strip(read("lib/finance/request-actions.ts"))).toContain("financeGuard(");
    expect(processPage).toContain("{transitPanel}");
    expect(processPage).toContain("{financePanel}");
  });

  it("ETA semantics are untouched by this change", () => {
    const intake = strip(read("lib/process/intake.ts"));
    expect(intake).toContain('warnings.push(issue("eta_missing"))');
    expect(intake).not.toContain('blocking.push(issue("eta_missing"))');
    for (const src of [eligibility, stepActions]) expect(src).not.toMatch(/\beta\b|ETA/);
  });

  it("no migration was added for this slice", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260929000001_ops_supervisor_file_update.sql");
  });

  it("the UAT dossier is named nowhere in the slice", () => {
    for (const src of [eligibility, stepActions, processPage, queueService, queueRow]) {
      expect(src).not.toMatch(/EFT-IMP-2026-0001\d|00010/);
    }
  });
});

// ═══════════ every refusal has words ═══════════════════════════════════════

describe("UAT-WF-STEP3-001 — a refusal the operator can read", () => {
  it("every code the two actions can REACH has French on the page", () => {
    // Derived from the two functions' own source, not from the whole
    // EngineError union: `already_initialized` belongs to initializeProcess and
    // can never arrive here, and UAT-00009 established that a surface must not
    // keep a sentence for a code that cannot occur.
    const fnSlice = (name: string) => {
      const i = engineActions.indexOf(`export async function ${name}`);
      const rest = engineActions.slice(i);
      const j = rest.indexOf(NL + "export ", 1);
      return j > 0 ? rest.slice(0, j) : rest;
    };
    const reachable = new Set<string>(["engine_disabled", "forbidden"]); // from guard()
    for (const name of ["activateStep", "submitStep"]) {
      for (const m of fnSlice(name).matchAll(/fail(?:WithEvidence)?\("([a-z_]+)"/g)) {
        reachable.add(m[1]);
      }
    }
    expect(reachable.size, "the reachable set must not be empty").toBeGreaterThan(5);
    const block = stepActions.slice(stepActions.indexOf("const ERROR_FR"));
    const keys = [...block.slice(0, block.indexOf("};")).matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
    for (const c of reachable) expect(keys, `${c} has no French sentence`).toContain(c);
    // …and nothing unreachable is kept.
    expect(keys).not.toContain("already_initialized");
  });

  it("outstanding evidence is named from the catalogue, not a filename", () => {
    expect(stepActions).toContain("r.missing ?? []");
    expect(stepActions).toContain("{m.labelFr}");
    expect(stepActions).not.toMatch(/storage_path|fileName/);
  });

  it("the guidance says where the step is performed", () => {
    const prereq = read("components/process/handoff-prerequisites.tsx");
    expect(prereq).toContain("Action à effectuer en premier");
    expect(prereq).toContain("Étapes actives");
  });
});
