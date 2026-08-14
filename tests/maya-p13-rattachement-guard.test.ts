/**
 * MAYA-P1.3 → P1.11 — rattachement (CEO step 9): the question, and the answer.
 * ---------------------------------------------------------------------------
 * P1.3 classified E and built nothing, because no source said what
 * « rattachement » attaches. Its guards existed to stop anyone defining the act
 * from its name, and its own header said they were meant to be rewritten the
 * day Effitrans answered §7 of docs/maya/maya-p1-3-rattachement-audit.md.
 *
 * Effitrans has answered. This file is that rewrite.
 *
 * What P1.3 protected still holds, restated against the ratified definition:
 * the act has ONE owner, ONE fact, and no neighbouring customs fact may prove
 * it. What P1.3 forbade — inventing the act — is no longer a risk, because the
 * act is now defined; the risk that replaces it is the P1.2 one, a proxy fact
 * completing the wrong department's step. That is what these now defend.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACT_RULES, evaluateStep, type ModuleFacts } from "@/lib/process/reconcile/satisfaction";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const step = (key: string) => EFFITRANS_PROCESS.find((s) => s.key === key);

/** Everything a customs dossier can carry EXCEPT the attachment itself. */
const everythingElse = (): ModuleFacts => ({
  fileType: "IMP",
  fileStatus: "IN_PROGRESS",
  customs: {
    status: "RELEASED",
    required: true,
    declarationNumber: "IMP-2026-000123",
    baeReference: "BAE-1",
    gaindeRegisteredAt: "2026-08-13T09:30:00.000Z",
    attachmentCompletedAt: null,
  },
  transport: { status: "POD_RECEIVED" },
  verifiedPodDocumentId: "pod-1",
  verifiedBaeDocumentId: "bae-1",
});

describe("CEO step 9 is defined, and mapped to the step that always described it", () => {
  it("the step Effitrans described already existed", () => {
    // « Il scanne les documents et fait lui-même le rattachement… dans GAINDE »
    // is registry step 11's own label, owner, manual nature and prerequisite.
    // P1.3's mapping doubt (a phantom `electronic_attachment`) is resolved.
    const s = step("gainde_document_submission")!;
    expect(s.stepNumber).toBe(11);
    expect(s.role).toBe("CUSTOMS_DECLARANT");
    expect(s.prerequisites).toContain("gainde_registration");
    expect(s.permissions).toContain("customs:update");
    expect(EFFITRANS_PROCESS.map((x) => x.key)).not.toContain("electronic_attachment");
  });

  it("it is now fact-provable, from its OWN fact", () => {
    expect(Object.keys(FACT_RULES)).toContain("gainde_document_submission");
    const rule = FACT_RULES.gainde_document_submission;
    const done = everythingElse();
    done.customs!.attachmentCompletedAt = "2026-08-14T10:00:00.000Z";
    expect(rule.satisfied(done)).toBe(true);
  });

  it("NO neighbouring customs fact proves it — the P1.2 protection, kept", () => {
    // Every other customs fact at once, and still not satisfied. This is the
    // guard P1.3 wrote, now aimed at the real rule instead of at absence.
    const r = evaluateStep({
      stepKey: "gainde_document_submission",
      facts: everythingElse(),
      execution: { stepKey: "gainde_document_submission", state: "AVAILABLE" },
    });
    expect(r.satisfaction).not.toBe("SATISFIED");
    expect(FACT_RULES.gainde_document_submission.satisfied(everythingElse())).toBe(false);
  });

  it("the rule reads the attachment and nothing else", () => {
    const s = code("lib/process/reconcile/satisfaction.ts");
    const rule = s.slice(s.indexOf("gainde_document_submission: {"), s.indexOf("customs_field_clearance: {"));
    expect(rule).toContain("attachmentCompletedAt");
    for (const foreign of ["baeReference", "declarationNumber", "verifiedBae", "status ==="]) {
      expect(rule, foreign).not.toContain(foreign);
    }
  });

  it("the answered questions are on the record", () => {
    const doc = read("docs/maya/maya-p1-3-rattachement-audit.md");
    expect(doc).toContain("What is attached to what?");
    const impl = read("docs/maya/maya-p1-11-rattachement.md");
    expect(impl).toContain("Facture, BL, toutes autorisations");
    expect(impl).toContain("le déclarant rattache de nouveau");
  });
});
