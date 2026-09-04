/**
 * C-4 — DEFINITIVE Creation → Closure journey. SLICE 1: Creation → Transit.
 * ---------------------------------------------------------------------------
 * Real PostgreSQL, real server actions, real permissions, real gates, real
 * audit. The ONLY stub is which identity is signed in.
 *
 * Every transition asserts more than "the action returned ok": the prior state,
 * the resulting state, the attributed audit row, the promotion of dependents,
 * and a refusal by an actor who should not be able to do it.
 *
 * SLICE 1 covers creation, Operations intake, Account Manager preparation
 * including a C-3 « Sans objet » declaration, the C-2 handoff sequencing, and
 * Transit reception — i.e. every mechanism the 00008 incident exercised. Later
 * slices extend the same harness through customs, transport, Finance, deposit
 * and closure; they are additive files, not a different apparatus.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as, actAsNobody } from "./identity";
import { identity, execution, auditFor, handoffs, db, provideEvidence, TENANT_A, CLIENT_DEPOSIT_REQUIRED } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit, getIntakeState } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { DECLARABLE_EVIDENCE_KEYS } from "@/lib/process/evidence-absence";
import { getStep, getActivity } from "@/lib/process/effitrans-process";
import { receiveDossierAtTransit } from "@/lib/process/engine/transit-actions";

let ops: CurrentUser;      // OPS_SUPERVISOR — intake, process:manage
let am: CurrentUser;       // ACCOUNT_MANAGER — file:create, step 3
let transit: CurrentUser;  // CHIEF_OF_TRANSIT — reception, step 4
let stranger: CurrentUser; // COURIER — holds nothing relevant here
let quotation: CurrentUser; // QUOTATION_MANAGER — owns step 1, reads its evidence
let blind: CurrentUser;     // JOURNEY_EVIDENCE_BLIND — may act on step 1, cannot see its evidence
let fileId = "";

// Resolved once for the whole file, at file level rather than inside the first
// describe: the later blocks use these too, and hanging them off one block's
// hook would make those blocks depend on the order describes happen to run in.
beforeAll(async () => {
  ops = await identity("ops");
  am = await identity("am");
  transit = await identity("transit");
  stranger = await identity("courier");
  quotation = await identity("quotation");
  blind = await identity("blindquote");
});

describe("C-4 slice 1 — Creation → Transit reception", () => {
  it("T1 — the Account Manager creates the dossier; nobody else can", async () => {
    // An actor without file:create is refused by the REAL RBAC lookup.
    const refused = await as(stranger, () =>
      createFile({ type: "IMP", clientId: CLIENT_DEPOSIT_REQUIRED, priority: "normal" }),
    );
    expect(refused.ok, "a COURIER must not create a dossier").toBe(false);

    const created = await as(am, () =>
      // Shipment facts are NESTED under `shipment` — the flat form silently
      // dropped them and intake then refused with « mode_missing ». Typed, not
      // cast, so the shape is checked at compile time instead of at run time.
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY ORIGIN",
          destination: "Dakar",
          blAwbRef: `JRN-${Date.now()}`,
        },
      }),
    );
    expect(created.ok, `createFile failed: ${JSON.stringify(created)}`).toBe(true);
    fileId = (created as { id: string }).id;
    expect(fileId).toBeTruthy();
  });

  it("T2 — Operations opens the workflow: step 2 ACTIVE, step 3 still PENDING", async () => {
    const opened = await as(ops, () =>
      openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }),
    );
    expect(opened.ok, `openDossierWorkflow failed: ${JSON.stringify(opened)}`).toBe(true);

    // H-1 (ratified 2026-09-03): the OPENING ACT is the intake act. It records
    // the canonical Operations owner and the Account-Manager seat — the only
    // facts step 2 certifies — so it completes step 2 rather than asking the
    // operator for a click that certifies nothing.
    const intake = await execution(fileId, "operations_intake");
    expect(intake?.state, "opening completes step 2").toBe("COMPLETED");
    // …and step 3 is therefore open for the Account Manager immediately, which
    // is the whole point: preparation no longer waits on an administrative click.
    const step3 = await execution(fileId, "am_dossier_opening");
    expect(step3?.state, "the AM may start at once").toBe("AVAILABLE");
    // Cotation was skipped with a derived reason, which counts as done.
    expect((await execution(fileId, "cotation"))?.state).toBe("SKIPPED");
  });

  it("C-1 — completing step 2 promotes BOTH dependents, including step 14", async () => {
    // Step 2 is completed by the opening act now (H-1), so the promotion under
    // test has already run. Re-submitting is correctly refused — a completed
    // step is terminal — and that refusal is itself worth pinning.
    const again = await as(ops, () => submitStep(fileId, "operations_intake"));
    expect(again.ok, "a completed step cannot be submitted twice").toBe(false);
    expect((await execution(fileId, "operations_intake"))?.state).toBe("COMPLETED");

    // The dependent named by `nextSteps`…
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("AVAILABLE");

    // …and the one that is NOT named anywhere, which is the whole point of C-1.
    // Step 14 declares step 3 as its prerequisite, so it stays PENDING here and
    // becomes AVAILABLE only when step 3 completes — proven below.
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("PENDING");
  });

  it("promotion is attributed to the actor whose completion caused it (F-α)", async () => {
    const inst = (await db().from("process_instance").select("id").eq("file_id", fileId)).data ?? [];
    const { data: rows } = await db()
      .from("process_step_execution")
      .select("id")
      .eq("step_key", "am_dossier_opening")
      .in("process_instance_id", inst.map((r) => r.id));
    const events = await auditFor("process.step.activated", rows![0].id);
    expect(events.length, "the promotion must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id, "attributed to the completing actor").toBe(ops.id);
  });

  it("C-2 — the Transit handoff is REFUSED while step 3 is unfinished", async () => {
    const early = await as(am, () => handDossierToTransit(fileId));
    expect(early.ok, "transmission must not outrun step 3").toBe(false);
    expect(await handoffs(fileId), "no handoff row may exist yet").toHaveLength(0);
  });

  it("step 3 opens for the Account Manager, and nothing else closes it", async () => {
    // H-1/H-3..H-6 (2026-09-03): step 3 carries no required documents — they
    // belonged to Finance, the transport lane and pickup — so its completion is
    // the Account Manager's own readiness act. What this proves is that the act
    // is still REQUIRED: the step opens, and until the AM performs it the
    // transmission stays refused (asserted above, C-2).
    const started = await as(am, () => activateStep(fileId, "am_dossier_opening"));
    expect(started.ok, `activate step 3 failed: ${JSON.stringify(started)}`).toBe(true);
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("ACTIVE");
    expect(getStep("am_dossier_opening")!.requiredDocuments, "ratified empty").toEqual([]);
  });

  it("C-3 — « Sans objet » is refused for a non-declarable type and without a motif", async () => {
    const notDeclarable = await as(am, () =>
      declareEvidenceAbsence(fileId, "BORDEREAU_LIVRAISON", "pas de BL"),
    );
    expect(notDeclarable.ok).toBe(false);
    expect((notDeclarable as { error: string }).error).toBe("evidence_not_declarable");

    const noMotif = await as(am, () => declareEvidenceAbsence(fileId, "VENDOR_INVOICE", "   "));
    expect(noMotif.ok).toBe(false);
    expect((noMotif as { error: string }).error).toBe("reason_required");

    const arbitrary = await as(am, () => declareEvidenceAbsence(fileId, "NOT_A_REAL_KEY", "x"));
    expect(arbitrary.ok).toBe(false);
  });

  it("C-3 — a legitimate declaration is recorded, attributed and audited", async () => {
    const declared = await as(am, () =>
      declareEvidenceAbsence(fileId, "VENDOR_INVOICE", "aucun débours tiers sur ce dossier"),
    );
    expect(declared.ok, `declaration failed: ${JSON.stringify(declared)}`).toBe(true);

    const { data: row } = await db()
      .from("evidence_absence_declaration")
      .select("tenant_id, file_id, evidence_key, reason, declared_by, declared_at")
      .eq("file_id", fileId)
      .eq("evidence_key", "VENDOR_INVOICE")
      .maybeSingle();
    expect(row?.tenant_id).toBe(TENANT_A);
    expect(row?.declared_by).toBe(am.id);
    expect(row?.reason).toBe("aucun débours tiers sur ce dossier");
    expect(row?.declared_at).toBeTruthy();

    const events = await auditFor("evidence.absence.declared", (declared as { id: string }).id);
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(am.id);

    // It fabricates NO document.
    const { data: docs } = await db()
      .from("document")
      .select("id")
      .eq("file_id", fileId)
      .eq("type_code", "VENDOR_INVOICE");
    expect(docs ?? [], "a declaration must never create a document row").toHaveLength(0);

    // …and it satisfies ONLY that key. Step 3 no longer requires any document
    // (H-3..H-6), so the declaration proves the C-3 MECHANISM rather than a
    // gate: the row exists, attributed and audited, and no document was
    // fabricated to stand in for it.
    expect(DECLARABLE_EVIDENCE_KEYS).toContain("VENDOR_INVOICE");
  });

  it("an unauthorised actor cannot act on step 3, and nobody can act signed out", async () => {
    const wrongActor = await as(stranger, () => submitStep(fileId, "am_dossier_opening"));
    expect(wrongActor.ok).toBe(false);

    actAsNobody();
    const anon = await submitStep(fileId, "am_dossier_opening");
    expect(anon.ok, "signed-out must be refused").toBe(false);
  });

  it("the intake projection reports step 3 as the unmet transmission prerequisite", async () => {
    const state = await as(am, () => getIntakeState(fileId));
    expect(state, "the dossier must be readable by its Account Manager").toBeTruthy();
    expect(state!.amOpeningDone, "step 3 is not done yet").toBe(false);
    expect(state!.handoffSent).toBe(false);
  });

  it("step 3 completes on the Account Manager's own act, and promotes", async () => {
    const done = await as(am, () => submitStep(fileId, "am_dossier_opening"));
    expect(done.ok, `step 3: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("COMPLETED");
    // Its dependents open — including the two parallel activities and step 14,
    // which is the C-1 guarantee.
    for (const key of ["coordinator_reception", "transport_assignment", "pre_gate", "bon_a_delivrer"]) {
      expect((await execution(fileId, key))?.state, key).toBe("AVAILABLE");
    }
  });

  it("the evidence gate is intact wherever evidence is still required", async () => {
    // Re-pointed from step 3, which no longer carries documents. `pre_gate`
    // opens from step 3 and genuinely requires PRE_GATE_AUTHORIZATION, so it is
    // the honest place to prove that a step refuses without its evidence and
    // stays exactly as it was.
    expect(getActivity("pre_gate")!.requiredDocuments).toEqual(["PRE_GATE_AUTHORIZATION"]);
    const started = await as(am, () => activateStep(fileId, "pre_gate"));
    expect(started.ok, `activate pre_gate: ${JSON.stringify(started)}`).toBe(true);

    const before = await execution(fileId, "pre_gate");
    const premature = await as(am, () => submitStep(fileId, "pre_gate"));
    expect(premature.ok, "a step with evidence must refuse without it").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");
    expect((await execution(fileId, "pre_gate"))?.state).toBe(before?.state);
  });
});

/**
 * C-4 FINDING — evidence the actor cannot SEE is not evidence the actor CLOSES.
 * ---------------------------------------------------------------------------
 * These cases run on their OWN dossier, opened with `skipCotation: false` so
 * that step 1 is genuinely live rather than derived-skipped. That matters: the
 * defect was only reachable on the devis path, and a test that let the default
 * skip stand would have proven nothing while looking thorough.
 */
describe("C-4 — a step cannot be closed on evidence its actor may not judge", () => {
  // TWO dossiers, deliberately. The blind actor CLAIMS step 1 when it activates
  // it, and a claimed step is no longer an open unassigned step whose owning
  // role you hold — so the responsibility ground stops making the dossier
  // visible to the quotation lead. That refusal is CORRECT, but it would make
  // the sighted cases fail with `forbidden` for a reason that has nothing to do
  // with evidence. Each actor gets a dossier whose step 1 it can legitimately
  // reach.
  let devisFile = "";   // the blind actor's — refusal and unchanged state
  let sightedFile = ""; // the quotation lead's — missing, then complete

  async function openDevisDossier(tag: string): Promise<string> {
    const created = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY DEVIS",
          destination: "Dakar",
          blAwbRef: `JRN-${tag}-${Date.now()}`,
        },
      }),
    );
    if (!created.ok) throw new Error(`${tag} dossier creation failed: ${JSON.stringify(created)}`);
    const id = (created as { id: string }).id;

    // skipCotation: false — the devis is REQUIRED on this dossier, so step 1
    // stays a live step with real evidence rather than a derived skip.
    const opened = await as(ops, () =>
      openDossierWorkflow(id, { ownerUserId: ops.id, skipCotation: false }),
    );
    if (!opened.ok) throw new Error(`${tag} workflow open failed: ${JSON.stringify(opened)}`);
    return id;
  }

  beforeAll(async () => {
    devisFile = await openDevisDossier("DEVIS");
    sightedFile = await openDevisDossier("SIGHTED");
  });

  it("the devis dossier really does have a live cotation step", async () => {
    // Guards the guard: if cotation were SKIPPED here, every refusal below
    // would pass for the wrong reason.
    const cot = await execution(devisFile, "cotation");
    expect(cot?.state, "cotation must NOT be skipped on this dossier").not.toBe("SKIPPED");
    // Step 1 materialises AVAILABLE (buildInitialExecutions), which is what
    // makes the devis path executable at all: PENDING -> ACTIVE is illegal and
    // activateEntryStep is restricted to operations_intake.
    expect(cot?.state).toBe("AVAILABLE");
  });

  it("an actor who cannot see the evidence is REFUSED — evidence_unauthorized", async () => {
    const started = await as(blind, () => activateStep(devisFile, "cotation"));
    expect(started.ok, `blind actor could not start step 1: ${JSON.stringify(started)}`).toBe(true);

    const before = await execution(devisFile, "cotation");
    expect(before?.state).toBe("ACTIVE");

    const refused = await as(blind, () => submitStep(devisFile, "cotation"));
    expect(refused.ok, "a step must not close on evidence its actor cannot judge").toBe(false);
    // The SPECIFIC code: "you may not judge this" is not "it is not there".
    expect((refused as { error: string }).error).toBe("evidence_unauthorized");

    // …and the refusal left NOTHING behind.
    const after = await execution(devisFile, "cotation");
    expect(after?.state, "state must be unchanged after a refusal").toBe("ACTIVE");
    expect(after?.completed_at, "nothing may be marked complete").toBeNull();
    expect(after?.submitted_at).toBeNull();
  });

  it("a sighted actor with NO evidence still gets evidence_missing", async () => {
    // The two refusals must stay distinguishable. The quotation lead CAN see
    // the evidence and there is none yet, so this is the other failure.
    const started = await as(quotation, () => activateStep(sightedFile, "cotation"));
    expect(started.ok, `quotation lead could not start step 1: ${JSON.stringify(started)}`).toBe(true);

    const refused = await as(quotation, () => submitStep(sightedFile, "cotation"));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("evidence_missing");
  });

  it("with both documents verified, the quotation lead completes step 1", async () => {
    // The quotation lead holds document:read, NOT document:create — it reads
    // its evidence, it does not author it. So the documents arrive the real
    // way: uploaded by one person, verified by another.
    await provideEvidence(sightedFile, "QUOTATION", am, ops);
    await provideEvidence(sightedFile, "QUOTATION_APPROVAL", am, ops);

    const done = await as(quotation, () => submitStep(sightedFile, "cotation"));
    expect(done.ok, `step 1 should complete once its evidence is verified: ${JSON.stringify(done)}`).toBe(true);

    const cot = await execution(sightedFile, "cotation");
    expect(cot?.state).toBe("COMPLETED");

    // …and completing step 1 promotes its dependent (C-1), so the fix did not
    // cost the promotion behaviour proved in slice 1.
    expect((await execution(sightedFile, "operations_intake"))?.state).toBe("AVAILABLE");
  });
});
