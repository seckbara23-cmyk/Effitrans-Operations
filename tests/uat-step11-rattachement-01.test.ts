/**
 * UAT-STEP11-RECONCILE-01 — the rattachement is the proof, and the platform
 * was checking something else.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it executed on EFT-IMP-2026-00011. The Déclarant started step
 * 11, pressed « Enregistrer le rattachement — GAINDE + ORBUS » once, and the
 * act landed: `attachment_completed_at = 2026-09-09 21:38:13Z`,
 * `attachment_systems = {GAINDE, ORBUS}`, `attachment_completed_by =
 * douane.demo`. The card said « Rattaché le 09/09/2026 ».
 *
 * And the step went on saying « Action requise : Preuve d'introduction des
 * documents dans GAINDE. » with no « Terminer » offered, because TWO
 * PREDICATES ANSWERED FOR ONE STEP and they disagreed:
 *
 *   FACT_RULES.gainde_document_submission  → satisfied (reads the act)
 *   evaluateStepEvidence(GAINDE_SUBMISSION_EVIDENCE) → missing (wants an upload)
 *
 * The evidence key fell through to the document catalogue, so only a VERIFIED
 * `GAINDE_SUBMISSION_EVIDENCE` document could satisfy it. `submitStep` refuses
 * on that (`evidence_missing`) and the reconciler refuses on the same check
 * (`if (ev.unauthorized.length > 0 || !ev.complete) continue`) — so step 11
 * could not close by ANY route: not by the human door, not by convergence.
 *
 * WHAT THE RATIFICATION ACTUALLY SAYS. MAYA-P1.11 built the act, migration
 * 20260828000001 carries it, DEC-C40's own source string says « migration
 * 20260828000001 y porte le fait », and `maya-p111-rattachement.test.ts` states
 * the rule in as many words: « a screenshot is NEVER a precondition ».
 *
 * THE REPAIR IS STRICTLY WIDENING. The gate stays HARD — with neither the act
 * nor a document, step 11 still cannot complete and steps 12–13 still rest on
 * real proof. What changes is that the act Effitrans ratified now counts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateStepEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { FACT_RULES, evaluateStep, type ModuleFacts } from "@/lib/process/reconcile/satisfaction";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { blockingRequirements } from "@/lib/process/requirement-class";
import { getStep } from "@/lib/process/effitrans-process";
import { prerequisitesMet } from "@/lib/process/engine/state";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const S11 = "gainde_document_submission";
const S12 = "customs_followup";
const ATTACHED_AT = "2026-09-09T21:38:13.479Z";
const CUSTOMS_ATTACHMENT_MIGRATION = "supabase/migrations/20260828000001_customs_attachment.sql";

/** The dossier's evidence snapshot, with the rattachement present or absent. */
const snap = (over: Partial<EvidenceSnapshot["customs"]> | null = null, docs: EvidenceSnapshot["documents"] = []): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: docs,
  customs: over === null
    ? null
    : {
        required: true,
        status: "INSPECTION",
        baeReference: null,
        declarationNumber: "UAT-00011",
        externalRef: "UAT-GAINDE-DECL-00011",
        attachmentCompletedAt: null,
        ...over,
      },
  transport: null,
  invoices: [],
} as unknown as EvidenceSnapshot);

const verifiedProof = [{ typeCode: "GAINDE_SUBMISSION_EVIDENCE", status: "VERIFIED" }] as unknown as EvidenceSnapshot["documents"];

const DECLARANT = {
  userId: "u-declarant",
  permissions: ["customs:create", "customs:update", "document:create", "process:handoff:receive"],
  roles: ["CUSTOMS_DECLARANT"],
};

const step11Facts = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: S11,
  state: "ACTIVE",
  assignedUserId: DECLARANT.userId,
  custody: "not_applicable",
  owningRole: "CUSTOMS_DECLARANT",
  missingPrerequisites: [],
  requirements: [],
  notApplicable: null,
  ...over,
});

/** The evidence items as a surface would receive them. */
const requirementsFrom = (s: EvidenceSnapshot) =>
  evaluateStepEvidence(S11, s).items
    .filter((i) => i.status !== "satisfied")
    .map((i) => ({ key: i.key, labelFr: i.labelFr, status: i.status as "missing" }));

const moduleFacts = (attachmentCompletedAt: string | null): ModuleFacts => ({
  fileType: "IMP",
  fileStatus: "IN_PROGRESS",
  customs: {
    status: "INSPECTION",
    required: true,
    declarationNumber: "UAT-00011",
    baeReference: null,
    gaindeRegisteredAt: "2026-09-09T19:48:15.115Z",
    gaindeTaxPaid: true,
    attachmentCompletedAt,
  },
  transport: null,
  verifiedPodDocumentId: null,
} as unknown as ModuleFacts);

// ===========================================================================
describe("1 — no rattachement: the gate holds", () => {
  it("the evidence is missing, and it is a HARD blocker", () => {
    const ev = evaluateStepEvidence(S11, snap({}));
    expect(ev.complete).toBe(false);
    expect(ev.missing).toContain("GAINDE_SUBMISSION_EVIDENCE");
    expect(blockingRequirements(S11, ev).length).toBeGreaterThan(0);
  });

  it("…so the Déclarant is offered no completion, and the reason names the proof", () => {
    const el = evaluateStepAction(step11Facts({ requirements: requirementsFrom(snap({})) }), DECLARANT);
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toContain("Preuve d'introduction des documents dans GAINDE");
  });

  it("…and the reconciler will not complete it either", () => {
    expect(FACT_RULES[S11].satisfied(moduleFacts(null))).toBe(false);
  });
});

// ===========================================================================
describe("2/3/4 — the three ratified modes", () => {
  // The systems are recorded ON the act; the RPC accepts GAINDE, ORBUS or both
  // and refuses anything else. The evidence question is whether the act
  // happened — mode is provenance, not a second gate. Effitrans ratified the
  // three sets (ATTACHMENT_SYSTEM_SETS) and this asserts all three satisfy.
  it("GAINDE, ORBUS and GAINDE+ORBUS are the only accepted sets, at both layers", () => {
    const m = read(CUSTOMS_ATTACHMENT_MIGRATION);
    expect(m).toMatch(/array\['GAINDE', 'ORBUS'\]/);
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toContain('ATTACHMENT_SYSTEM_SETS');
    const actions = code("lib/customs/actions.ts");
    expect(actions).toContain('s === "GAINDE" || s === "ORBUS"');
    expect(actions).toContain('"unknown_system"');
  });

  it("a recorded act satisfies the evidence whatever the systems set", () => {
    // The act is one column; the systems are another. No mode may be a second
    // gate unless Effitrans rules one — see the open question in the report.
    const ev = evaluateStepEvidence(S11, snap({ attachmentCompletedAt: ATTACHED_AT }));
    expect(ev.complete).toBe(true);
    expect(ev.satisfied).toContain("GAINDE_SUBMISSION_EVIDENCE");
    expect(ev.missing).toEqual([]);
    expect(blockingRequirements(S11, ev)).toEqual([]);
  });

  it("…and the fact rule agrees, as it always did", () => {
    expect(FACT_RULES[S11].satisfied(moduleFacts(ATTACHED_AT))).toBe(true);
  });

  it("THE TWO PREDICATES NOW AGREE — which is the whole defect", () => {
    for (const at of [null, ATTACHED_AT]) {
      const evidenceSaysDone = evaluateStepEvidence(S11, snap({ attachmentCompletedAt: at })).complete;
      const factSaysDone = FACT_RULES[S11].satisfied(moduleFacts(at));
      expect(evidenceSaysDone, `attachment=${at}`).toBe(factSaysDone);
    }
  });

  it("an uploaded, verified proof still satisfies it — nobody on that route is stranded", () => {
    const ev = evaluateStepEvidence(S11, snap({}, verifiedProof));
    expect(ev.complete).toBe(true);
    expect(ev.satisfied).toContain("GAINDE_SUBMISSION_EVIDENCE");
  });
});

// ===========================================================================
describe("5 — the completion path the Déclarant can actually reach", () => {
  it("with the act recorded, « Terminer » is offered", () => {
    const el = evaluateStepAction(
      step11Facts({ requirements: requirementsFrom(snap({ attachmentCompletedAt: ATTACHED_AT })) }),
      DECLARANT,
    );
    expect(el.canSubmit).toBe(true);
    expect(el.reasonFr).toBeNull();
  });

  it("…and reconciliation may also close it, because the step is fact-provable", () => {
    const verdict = evaluateStep({
      stepKey: S11,
      facts: moduleFacts(ATTACHED_AT),
      execution: { stepKey: S11, state: "ACTIVE" },
    });
    expect(verdict.satisfaction).toBe("SATISFIED");
    // The rattachement action triggers exactly that convergence.
    const fn = code("lib/customs/actions.ts");
    const body = fn.slice(
      fn.indexOf("export async function recordCustomsAttachment"),
      fn.indexOf("export async function", fn.indexOf("export async function recordCustomsAttachment") + 1),
    );
    expect(body).toContain('cause: "customs_attachment"');
    expect(body).toContain("reconcileDossierProcess");
  });
});

// ===========================================================================
describe("6/7 — step 12 stays behind step 11", () => {
  it("step 12 waits on step 11, and this repair does not touch that", () => {
    expect(getStep(S12)!.prerequisites).toContain(S11);
    expect(getStep(S12)!.stepNumber).toBe(12);
  });

  it("step 12's prerequisites are UNMET while step 11 is ACTIVE, act recorded or not", () => {
    for (const s11state of ["ACTIVE", "AVAILABLE", "PENDING"] as const) {
      expect(
        prerequisitesMet(S12, [
          { stepKey: "coordinator_to_declarant", state: "COMPLETED" },
          { stepKey: "gainde_registration", state: "COMPLETED" },
          { stepKey: S11, state: s11state },
        ]),
        s11state,
      ).toBe(false);
    }
  });

  it("…and MET only once step 11 is genuinely COMPLETED", () => {
    expect(
      prerequisitesMet(S12, [
        { stepKey: "coordinator_to_declarant", state: "COMPLETED" },
        { stepKey: "gainde_registration", state: "COMPLETED" },
        { stepKey: S11, state: "COMPLETED" },
      ]),
    ).toBe(true);
  });
});

// ===========================================================================
describe("8/9 — steps 6 and 9 are untouched", () => {
  it("the rattachement act writes neither the declaration reference nor the payment", () => {
    const m = code(CUSTOMS_ATTACHMENT_MIGRATION);
    expect(m).not.toMatch(/gainde_declaration_reference\s*=/);
    expect(m).not.toMatch(/external_ref\s*=/);
    expect(m).not.toMatch(/gainde_registered_at\s*=|gainde_registered_by\s*=/);
    expect(m).not.toMatch(/gainde_tax_payment/);
  });

  it("and this repair reads those columns without writing anything at all", () => {
    // Both changed modules are pure read-side: no client, no writer, no action.
    for (const f of ["lib/process/engine/evidence.ts", "lib/process/documents.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/getAdminSupabaseClient|"use server"|\.update\(|\.insert\(|writeAudit/);
    }
    // The snapshot only widened its SELECT list.
    const snapSrc = read("lib/process/engine/snapshot.ts");
    expect(snapSrc).toContain("attachment_completed_at");
    expect(snapSrc).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });
});

// ===========================================================================
describe("10/11/12 — authority, tenancy and re-recording", () => {
  it("10 — the act demands customs:update, and no role gained anything", () => {
    const fn = code("lib/customs/actions.ts");
    const body = fn.slice(
      fn.indexOf("export async function recordCustomsAttachment"),
      fn.indexOf("export async function", fn.indexOf("export async function recordCustomsAttachment") + 1),
    );
    expect(body).toContain('assertPermission("customs:update")');
    expect(read(CUSTOMS_ATTACHMENT_MIGRATION))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
    const declarant = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CUSTOMS_DECLARANT")!;
    expect(declarant.permissions).toContain("customs:update");
    // Nothing here grants a customs capability to a role that lacked it.
    for (const role of ["TRANSPORT_OFFICER", "BILLING_OFFICER", "COURIER"]) {
      const t = TENANT_ROLE_TEMPLATES.find((x) => x.key === role);
      if (t) expect(t.permissions, role).not.toContain("customs:update");
    }
  });

  it("11 — the record is loaded tenant-scoped before anything is read or written", () => {
    const fn = code("lib/customs/actions.ts");
    const body = fn.slice(
      fn.indexOf("export async function recordCustomsAttachment"),
      fn.indexOf("export async function", fn.indexOf("export async function recordCustomsAttachment") + 1),
    );
    expect(body).toContain("loadCustoms(supabase, id, user.tenantId)");
    expect(body).toContain("isFileVisible(user.id, user.tenantId, rec.file_id)");
    // The RPC derives the tenant from the record, never from the caller.
    expect(read(CUSTOMS_ATTACHMENT_MIGRATION)).toMatch(/into v_tenant[\s\S]{0,160}from public\.customs_record/);
    // And the evidence snapshot is tenant-scoped too.
    expect(read("lib/process/engine/snapshot.ts")).toContain('scopedFrom(admin, "customs_record", tenantId)');
  });

  it("12 — re-recording stays possible and cannot duplicate the authoritative fact", () => {
    // The UI keeps all three buttons on purpose: a refused recevabilité may
    // require redoing the rattachement. It is ONE column on ONE row, so a
    // repeat replaces the fact rather than adding a second one…
    const m = read(CUSTOMS_ATTACHMENT_MIGRATION);
    expect(m).toMatch(/set attachment_completed_at = now\(\)/);
    expect(m).not.toMatch(/insert into public\.customs_record/);
    // …and it can never complete the workflow twice: reconciliation refuses a
    // step that is already COMPLETED.
    const verdict = evaluateStep({
      stepKey: S11,
      facts: moduleFacts(ATTACHED_AT),
      execution: { stepKey: S11, state: "COMPLETED" },
    });
    expect(verdict.satisfaction).toBe("SATISFIED");
    // …but the completion path refuses a COMPLETED row (mayReconcileComplete).
    expect(read("lib/process/reconcile/satisfaction.ts")).toMatch(/persistedState === "ACTIVE"/);
  });
});

// ===========================================================================
describe("13 — the production dossier recovers with no data repair", () => {
  it("EFT-IMP-2026-00011's exact facts now satisfy step 11", () => {
    // Read-only probe, 2026-09-09: attachment_completed_at set, systems
    // {GAINDE, ORBUS}, step 11 ACTIVE and claimed by the Déclarant, zero
    // GAINDE_SUBMISSION_EVIDENCE documents on the dossier.
    const production = snap({ attachmentCompletedAt: ATTACHED_AT }, []);
    const ev = evaluateStepEvidence(S11, production);
    expect(ev.complete, "no upload exists, and none is needed").toBe(true);

    const el = evaluateStepAction(
      step11Facts({ state: "ACTIVE", requirements: requirementsFrom(production) }),
      DECLARANT,
    );
    expect(el.canSubmit, "the Déclarant can finish it himself").toBe(true);
  });

  it("the gate is still HARD — this is a widening, not a removal", () => {
    const governance = blockingRequirements(S11, evaluateStepEvidence(S11, snap({})));
    expect(governance.length, "with no proof at all, step 11 is still blocked").toBeGreaterThan(0);
    expect(read("lib/process/requirement-class.ts"))
      .toContain('"gainde_document_submission::GAINDE_SUBMISSION_EVIDENCE": hard(RATTACHEMENT)');
  });
});
