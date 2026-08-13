/**
 * MAYA-P1.8 — process conflict visibility: classification E, pinned.
 * ---------------------------------------------------------------------------
 * WES-5 can return `conflicts` and nothing consumes them. That is real — but the
 * census found it is not the systemic gap it looked like:
 *
 *   conflicts in all of production ......... 1
 *   dossiers with process executions ....... 1  (EFT-IMP-2026-00003, CLOSED)
 *   conflicts on ACTIVE work ............... 0
 *   resolution capabilities that exist ..... 0
 *   business surfaces that could host one .. 0
 *
 * The single conflict is the one MAYA-P1.2 created deliberately and documented:
 * `gainde_registration` completed under the old Declarant proxy, contradicted by
 * the corrected rule that reads Finance's milestone.
 *
 * So this phase built nothing. Four of the brief's stop conditions hold at once:
 * ownership undefined, resolution semantics undefined, no appropriate surface
 * (the only warning region lives on a route that declares itself DIAGNOSTIC
 * ONLY), and file/process closure independence intentional but undocumented.
 *
 * These guards defend the three things a future conflict phase must not break,
 * and reproduce the exact production verdict so the finding cannot decay.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateStep, type ModuleFacts } from "@/lib/process/reconcile/satisfaction";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RECONCILE = "lib/process/reconcile/service.ts";
const TOWER = "lib/process/queues/control-tower.ts";

/** EFT-IMP-2026-00003 as production actually holds it. */
const productionDossier = (): ModuleFacts => ({
  fileType: "IMP",
  fileStatus: "CLOSED",
  customs: {
    status: "RELEASED", required: true,
    declarationNumber: "IMP-2026-000123", baeReference: "GAINDE-2026-458721",
    gaindeRegisteredAt: null, // Finance never registered — the contradiction
  },
  transport: { status: "DELIVERED" },
  verifiedPodDocumentId: "pod-consumed-as-evidence",
  verifiedBaeDocumentId: null,
});

const at = (stepKey: string, state: string | null, facts = productionDossier()) =>
  evaluateStep({ stepKey, facts, execution: state ? { stepKey, state } : null });

// ===========================================================================
describe("the one production conflict, reproduced exactly", () => {
  it("gainde_registration is the ONLY conflicting step on that dossier", () => {
    // All five fact-provable steps are COMPLETED/RECONCILED in production.
    // Four are still proven by their facts; one is not.
    expect(at("gainde_registration", "COMPLETED").satisfaction).toBe("CONFLICT");

    for (const step of ["am_dossier_opening", "customs_field_clearance", "pickup", "transport_pod_handoff"]) {
      expect(at(step, "COMPLETED").satisfaction, step).toBe("SATISFIED");
    }
  });

  it("it clears by itself the moment the fact becomes true — nothing to resolve", () => {
    // A conflict is a verdict, not a record. No acknowledge, no dismiss.
    const registered = productionDossier();
    registered.customs!.gaindeRegisteredAt = "2026-08-13T09:30:00.000Z";
    expect(evaluateStep({
      stepKey: "gainde_registration", facts: registered,
      execution: { stepKey: "gainde_registration", state: "COMPLETED" },
    }).satisfaction).toBe("SATISFIED");
  });

  it("a conflict names the missing fact in business French", () => {
    const r = at("gainde_registration", "COMPLETED");
    expect(r.factFr).toContain("Enregistrement GAINDE effectué par la Finance");
    expect(r.factFr).toMatch(/marquée terminée mais le fait attendu est absent/);
  });

  it("only COMPLETED/APPROVED can conflict — an open step never does", () => {
    for (const state of ["AVAILABLE", "ACTIVE", "PENDING", "BLOCKED", "SUBMITTED"]) {
      expect(at("gainde_registration", state).satisfaction, state).not.toBe("CONFLICT");
    }
    expect(at("gainde_registration", "APPROVED").satisfaction).toBe("CONFLICT");
  });
});

// ===========================================================================
describe("conflicts are computed and discarded — the technical gap, recorded", () => {
  it("the service returns them and no caller reads them", () => {
    expect(code(RECONCILE)).toContain("conflicts: { stepKey: string; factFr: string }[]");
    // Every call site awaits the service and ignores the result.
    for (const f of [
      "lib/customs/actions.ts", "lib/documents/actions.ts",
      "lib/transport/actions.ts", "lib/transport/pod-receipt.ts",
    ]) {
      const s = code(f);
      expect(s, f).toContain("await reconcileDossierProcess({");
      expect(s, `${f} must not silently start consuming conflicts`).not.toMatch(/=\s*await reconcileDossierProcess/);
    }
  });

  it("nothing persists a conflict — and nothing needs to", () => {
    // The verdict is pure over facts already stored, so a future surface needs
    // no migration. Storage was never the blocker; audience and ownership are.
    expect(read("lib/platform/ops/build-info.ts")).toContain("MIGRATION_COUNT = 105");
    expect(code(RECONCILE)).not.toMatch(/insert into|\.insert\(/);
    expect(code("lib/process/reconcile/satisfaction.ts")).not.toMatch(/acknowledg|dismiss|resolved/i);
  });

  it("the model still refuses to RESOLVE a conflict on its own", () => {
    // WES-5's whole doctrine: report, never pick a winner. Regressing a step
    // would erase a human's record; trusting it would manufacture a fact.
    expect(read("lib/process/reconcile/satisfaction.ts"))
      .toContain("CONFLICTS ARE RETURNED, NEVER RESOLVED");
    expect(code(RECONCILE)).toContain("result.conflicts.push({ stepKey, factFr: evaluation.factFr })");
    expect(code(RECONCILE)).toMatch(/if \(evaluation\.satisfaction === "CONFLICT"\)[\s\S]{0,120}continue;/);
  });
});

// ===========================================================================
describe("P1.7 must not be undone to make conflicts visible", () => {
  it("terminal dossiers stay out of active workload", () => {
    // The brief's explicit prohibition, and the reason it matters: the only
    // conflicting dossier is CLOSED. Surfacing it must never mean counting it.
    const t = code(TOWER);
    expect(t).toContain("if (!activeFileIds.has(fileId)) continue;");
    expect(t).toContain("isActiveFile(");
  });

  it("no exception centre, dashboard or conflict route was invented", () => {
    const doc = read("docs/maya/maya-p1-8-conflict-visibility-audit.md");
    expect(doc).toContain("BUSINESS / ARCHITECTURE DECISION REQUIRED");
    expect(doc).toContain("Who owns a process conflict?");
    // The one candidate surface disqualifies itself, in its own words.
    expect(read("app/files/[id]/process/page.tsx")).toContain("DIAGNOSTIC ONLY");
  });

  it("closure independence is preserved, not collapsed", () => {
    // Collapsing the two doors would hand every file:transition holder the
    // authority the collections migration deliberately withheld.
    expect(code("lib/collections/actions.ts")).toContain('assertPermission("process:close")');
    expect(code("lib/files/actions.ts")).toContain('assertPermission("file:transition")');
    expect(code("lib/files/actions.ts")).not.toContain("process_instance");
  });
});
