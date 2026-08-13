/**
 * MAYA-P1.3 — rattachement (CEO step 9): the audit's negative findings, pinned.
 * ---------------------------------------------------------------------------
 * P1.3 classified E — BUSINESS DEFINITION REQUIRED — and built nothing. The one
 * thing worth defending is the finding itself, because it decays in exactly two
 * ways and both have already happened once on the neighbouring step.
 *
 *   1. A PROXY FACT COMPLETES THE STEP. MAYA-P1.2 found `gainde_registration`
 *      being completed from the Declarant's declaration number — the wrong
 *      department's work, marked done, in production. The step CEO step 9 most
 *      plausibly maps to, `gainde_document_submission`, is human-only today
 *      only because it is ABSENT from FACT_RULES. Absence is a weak guarantee;
 *      this makes it an explicit one.
 *
 *   2. SOMEBODY DEFINES THE ACT FROM ITS NAME. No source says what is attached
 *      to what. A column, a permission or a rule appearing without that answer
 *      would be invented business meaning, which is the failure mode this
 *      programme exists to avoid.
 *
 * These are guards, not a feature. When Effitrans answers §7 of
 * docs/maya/maya-p1-3-rattachement-audit.md, they are meant to be rewritten.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACT_RULES, evaluateStep } from "@/lib/process/reconcile/satisfaction";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const step = (key: string) => EFFITRANS_PROCESS.find((s) => s.key === key);

describe("CEO step 9 stays undefined until Effitrans defines it", () => {
  it("the Déclarant step after GAINDE registration exists, and is human-only", () => {
    // The step is real and correctly owned; what it lacks is a completion fact.
    const s = step("gainde_document_submission")!;
    expect(s.role).toBe("CUSTOMS_DECLARANT");
    expect(s.prerequisites).toContain("gainde_registration");
    // Human-only BY DEFAULT is the WES-5 rule; make it explicit for this step.
    expect(Object.keys(FACT_RULES)).not.toContain("gainde_document_submission");
  });

  it("no proxy fact can complete it — the MAYA-P1.2 defect must not recur here", () => {
    // Every fact a customs dossier can carry, at once. A human-only step is
    // NOT_STARTED regardless: the model has no opinion beyond what is persisted.
    const everything = {
      fileType: "IMP",
      fileStatus: "IN_PROGRESS",
      customs: {
        status: "RELEASED",
        required: true,
        declarationNumber: "IMP-2026-000123",
        baeReference: "BAE-1",
        gaindeRegisteredAt: "2026-08-13T09:30:00.000Z",
      },
      transport: { status: "POD_RECEIVED" },
      verifiedPodDocumentId: "pod-1",
      verifiedBaeDocumentId: "bae-1",
    };
    const r = evaluateStep({ stepKey: "gainde_document_submission", facts: everything, execution: null });
    expect(r.satisfaction).toBe("NOT_STARTED");
    expect(r.factFr).toBe("Étape à réaliser par une personne");
  });

  it("no durable fact, permission, action or event was invented for it", () => {
    // The whole point of classification E. If any of these appears, the act was
    // defined from its name — the failure the audit refused.
    const surfaces = [
      "lib/customs/actions.ts",
      "lib/process/reconcile/satisfaction.ts",
      "lib/workflow/events/types.ts",
      "lib/platform/role-templates.ts",
    ];
    for (const f of surfaces) {
      expect(code(f), f).not.toMatch(/rattachement|electronic_attachment|customs:attach/i);
    }
    // …and no migration created a column for it.
    const bi = read("lib/platform/ops/build-info.ts");
    expect(bi).toContain("MIGRATION_COUNT = 105");
  });

  it("the audit is on the record, with the unanswered question stated", () => {
    // A classification that lives only in a chat log is not a finding.
    const doc = read("docs/maya/maya-p1-3-rattachement-audit.md");
    expect(doc).toContain("BUSINESS DEFINITION REQUIRED");
    // The quote wraps in the document, so match within one line of it.
    expect(doc).toContain("vérification du rattachement via");
    expect(doc).toContain("liens électroniques");
    expect(doc).toContain("What is attached to what?");
    // The step-key divergence that makes even the MAPPING uncertain.
    expect(doc).toContain("electronic_attachment");
    expect(EFFITRANS_PROCESS.map((s) => s.key)).not.toContain("electronic_attachment");
  });
});
