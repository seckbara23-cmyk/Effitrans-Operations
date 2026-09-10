/**
 * C-4 SLICE 2 — Transit reception → customs → GAINDE → BAE (steps 4–13).
 * ---------------------------------------------------------------------------
 * Same apparatus as slice 1, additive file. Real Postgres, real server actions,
 * real permissions, real evidence, real audit. Nothing is written directly:
 * every state change below is produced by the action an operator would invoke.
 *
 * The cases run in order and each performs ONE transition and asserts what it
 * produced — prior state, resulting state, promotion of dependents, and audit
 * attribution — so a failure names the step that broke rather than the chain.
 *
 * The dossier is carried from creation, because a journey that started at step
 * 4 from hand-made state would prove the engine accepts a fixture, not that the
 * business can reach step 4.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as } from "./identity";
import {
  identity, execution, auditFor, handoffs, provideEvidence, customsIdFor, customsReleaseState,
  CLIENT_DEPOSIT_REQUIRED, gaindeTaxPayment, customsGovernedElements,
  gaindePayments, gaindePaymentLines, customsRecordRefs, db,
  customsEventActor, customsEventCount, } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile, assignCommercialOwner } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae, decideTransitRelease, finalizeTransitRelease } from "@/lib/process/engine/transit-actions";
import {
  createCustoms, recordGaindeRegistration, changeCustomsStatus, recordCustomsValidation,
  recordDeclarationReference, updateCustoms, recordCustomsAttachment,
} from "@/lib/customs/actions";
import { assertControlStep } from "@/lib/process/control-gate-server";
import { getDossierWork } from "@/lib/process/work-service";
import { evaluateStepAction } from "@/lib/process/step-eligibility";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { contextualStatus } from "@/lib/process/contextual/view";
import { getControlVerdicts } from "@/lib/process/control-ownership-server";

let ops: CurrentUser;            // OPS_SUPERVISOR — customs:validate (independent checker)
let am: CurrentUser;             // ACCOUNT_MANAGER
let transit: CurrentUser;        // CHIEF_OF_TRANSIT — customs:create AND customs:validate
let declarant: CurrentUser;      // CUSTOMS_DECLARANT — customs:create/update, NO customs:validate
let coordinator: CurrentUser;    // COORDINATOR — the handoff steps
let customsFinance: CurrentUser; // CUSTOMS_FINANCE_OFFICER — customs:register
let field: CurrentUser;          // CUSTOMS_FIELD_AGENT — customs:release

let fileId = "";

/** ATTR-CUSTOMS-01 — the step 7 validation instant, captured when the Chef validates. */
let step7ReviewedAt: string | null = null;

/**
 * UAT-STEP9-FINANCE-01 — THE DECLARATION FINANCE PAYS AGAINST.
 *
 * One string, used twice on purpose: the Déclarant records it at step 6, and
 * Finance reuses it at step 9. That reuse is the whole business fact, and it
 * is exactly what this journey never did before — it invented a fresh
 * `GAINDE-JRN-${Date.now()}` for Finance, so the production condition (an
 * existing reference, reused) was never exercised and the RPC's leftover
 * reference guard stayed invisible until a human hit it.
 */
const DECLARATION_REF = "JRN-GAINDE-DECL-0001";

/** Drive one step the way an operator does: claim it, then close it. */
async function runStep(actor: CurrentUser, stepKey: string) {
  const started = await as(actor, () => activateStep(fileId, stepKey));
  expect(started.ok, `activate ${stepKey}: ${JSON.stringify(started)}`).toBe(true);
  const done = await as(actor, () => submitStep(fileId, stepKey));
  expect(done.ok, `submit ${stepKey}: ${JSON.stringify(done)}`).toBe(true);
  return done;
}

/**
 * ATTR-CUSTOMS-01 — after every customs act from step 7 on, the four facts stay
 * on their own columns and `reviewed_by` stays the Chef who validated step 7.
 * Before the repair, finalising the release overwrote it with the field agent,
 * and the dossier read « Validé par » the wrong person.
 */
async function expectCustomsAttribution(
  stage: string,
  want: { recorder: string | null; approver: string | null; finaliser: string | null },
) {
  const s = await customsReleaseState(fileId);
  expect(s?.reviewed_by, `${stage}: reviewed_by must stay the step 7 validator`).toBe(transit.id);
  expect(s?.reviewed_at, `${stage}: the validation instant must not move`).toBe(step7ReviewedAt);
  expect(s?.bae_recorded_by ?? null, `${stage}: the BAE recorder`).toBe(want.recorder);
  expect(s?.release_approval_by ?? null, `${stage}: the release approver`).toBe(want.approver);
  expect(s?.released_by ?? null, `${stage}: the release finaliser`).toBe(want.finaliser);
}

/**
 * Hand a dossier from one department to the next the way the business does.
 *
 * HARNESS CORRECTION (not a platform defect): steps 8 and 10 were driven by
 * completing the step alone, which moves the engine but sends nothing. Finance
 * douane therefore never received the handoff, never gained handoff-receiver
 * visibility, and was refused `forbidden` at step 9 — correctly. Sending is a
 * real act with a real row, and receiving is a separate one.
 */
async function handOver(
  sender: CurrentUser,
  receiver: CurrentUser,
  fromStepKey: string,
  toStepKey: string,
) {
  const sent = await as(sender, () => sendHandoff(fileId, fromStepKey, toStepKey));
  expect(sent.ok, `sendHandoff ${fromStepKey}->${toStepKey}: ${JSON.stringify(sent)}`).toBe(true);

  const open = (await handoffs(fileId)).find(
    (h) => h.status === "SENT" && h.to_step_key === toStepKey,
  );
  expect(open, `no open handoff to ${toStepKey}`).toBeTruthy();
  expect(open!.sent_by).toBe(sender.id);

  const got = await as(receiver, () => receiveHandoff(fileId, open!.id as string));
  expect(got.ok, `receiveHandoff ${toStepKey}: ${JSON.stringify(got)}`).toBe(true);

  const closed = (await handoffs(fileId)).find((h) => h.id === open!.id);
  expect(closed!.status).toBe("RECEIVED");
  expect(closed!.received_by, "the receiver is recorded").toBe(receiver.id);
  expect(closed!.received_by, "and is not the sender").not.toBe(closed!.sent_by);
}

/**
 * THE CONTROLS THE DOSSIER PAGE ASKS FOR, verbatim.
 *
 * UAT-BLOCKER-STEP67-PROD-02 — `app/files/[id]/page.tsx` builds the customs
 * panel's verdicts from exactly this list, and `customs-panel.tsx` renders
 * `disabled={!gateOpen(id)}` from the result. Reproducing the list is what
 * makes the assertions below a test of the BROWSER'S path rather than of a
 * helper in isolation: the previous slice proved `assertControlStep`, which is
 * only consulted once a click has already happened.
 */
const PAGE_CUSTOMS_CONTROLS = [
  "customs.create",
  "customs.update",
  "customs.declaration_reference",
  "customs.status",
  "customs.receivability",
  "customs.attachment",
  "customs.gainde_registration",
  "customs.validation",
  "customs.bae",
  "customs.release",
] as const;

/** What the panel does with a verdict: enabled, and with no refusal sentence. */
function expectRendersEnabled(
  verdicts: Record<string, { allowed: boolean; reasonCode: string | null; reasonFr: string | null; isOwner: boolean }>,
  controlId: string,
) {
  const v = verdicts[controlId];
  expect(v, `${controlId} must have a verdict — an absent one is drawn UNGATED`).toBeTruthy();
  expect(v.isOwner, `${controlId} must be drawn for this viewer`).toBe(true);
  expect(v.allowed, `${controlId} must be ENABLED: ${JSON.stringify(v)}`).toBe(true);
  expect(v.reasonCode).toBeNull();
  expect(v.reasonFr, "an enabled control shows no refusal sentence").toBeNull();
}

/**
 * A viewer's REAL permissions, resolved the way the page resolves them.
 *
 * The rendered verdict depends on them, so a fixture list would prove only
 * that the fixture agrees with itself.
 */
const permissionsOf = (userId: string) => getEffectivePermissions(userId);

/**
 * The RENDERED verdict for one step and one viewer, through the same loader
 * the dossier page uses. Asserting `submitStep().ok` alone is what let four
 * consecutive UAT blockers ship with green engine tests.
 */
async function stepEligibility(file: string, stepKey: string, viewer: CurrentUser) {
  const view = await getDossierWork(file, {
    tenantId: viewer.tenantId,
    userId: viewer.id,
    permissions: await permissionsOf(viewer.id),
    roles: viewer.roles ?? [],
  });
  const node = view?.dossier.steps.find((n) => n.facts.stepKey === stepKey);
  if (!node) return null;
  return evaluateStepAction(node.facts, {
    userId: viewer.id,
    permissions: await permissionsOf(viewer.id),
    roles: viewer.roles ?? [],
  });
}

/** The activation audit for a step must name the actor who caused it. */
async function assertActivationAttributedTo(stepKey: string, actorId: string) {
  const exec = await execution(fileId, stepKey);
  const events = await auditFor("process.step.activated", exec!.id as string);
  expect(events.length, `${stepKey} activation must be audited`).toBeGreaterThan(0);
  expect(
    events.some((e) => e.actor_id === actorId),
    `${stepKey} activation must be attributed to the actor who caused it`,
  ).toBe(true);
}

describe("C-4 slice 2 — Transit reception → customs → GAINDE → BAE", () => {
  beforeAll(async () => {
    ops = await identity("ops");
    am = await identity("am");
    transit = await identity("transit");
    declarant = await identity("declarant");
    coordinator = await identity("coordinator");
    customsFinance = await identity("customsfinance");
    field = await identity("field");

    const created = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY SLICE2",
          destination: "Dakar",
          blAwbRef: `JRN-S2-${Date.now()}`,
        },
      }),
    );
    if (!created.ok) throw new Error(`slice 2 dossier creation failed: ${JSON.stringify(created)}`);
    fileId = (created as { id: string }).id;

    // OPS-OWNERSHIP-01 (K3) — designate the Responsable client BEFORE opening:
    // the opening act completes step 2 only when that governed designation
    // exists. This is the ratified sequence, not test scaffolding.
    await as(ops, () => assignCommercialOwner({ fileId: fileId, userId: am.id, reasonCode: "INITIAL" }));
    const opened = await as(ops, () =>
      openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }),
    );
    if (!opened.ok) throw new Error(`slice 2 workflow open failed: ${JSON.stringify(opened)}`);
  });

  // ------------------------------------------------------- reaching step 4 ----

  it("steps 2 and 3 complete on real evidence, opening the road to Transit", async () => {
    // H-1: step 2 was completed by the opening act, so step 3 is already open.
    expect((await execution(fileId, "operations_intake"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("AVAILABLE");

    const started = await as(am, () => activateStep(fileId, "am_dossier_opening"));
    expect(started.ok, `activate step 3: ${JSON.stringify(started)}`).toBe(true);

    // Two real documents, uploaded by one person and verified by another…
    await provideEvidence(fileId, "BORDEREAU_LIVRAISON", am, ops);

    // …and here is the defect this slice found, now closed. Verifying a
    // document runs WES-5 reconciliation, whose rule for step 3 asks only
    // whether the dossier is past DRAFT. It used to complete step 3 on that
    // proxy alone — with three of its four required artefacts still outstanding
    // — and promote nothing. Reconciliation now defers to the step's own
    // evidence, so the step is still open and still the operator's to close.
    const midway = await execution(fileId, "am_dossier_opening");
    expect(midway?.state, "reconciliation must not close a step on a proxy").toBe("ACTIVE");
    expect(midway?.completion_provenance).toBeNull();

    await provideEvidence(fileId, "TRANSPORT_REQUEST", am, ops);
    // …and two audited declared absences, which is the ratified way a
    // conditional artefact is accounted for rather than silently skipped.
    for (const key of ["VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]) {
      const d = await as(am, () =>
        declareEvidenceAbsence(fileId, key, `sans objet sur ce dossier — ${key}`),
      );
      expect(d.ok, `declare ${key}: ${JSON.stringify(d)}`).toBe(true);
    }

    const s3 = await as(am, () => submitStep(fileId, "am_dossier_opening"));
    expect(s3.ok, `step 3: ${JSON.stringify(s3)}`).toBe(true);
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("COMPLETED");
  });

  it("completing step 3 promotes Transit AND step 14 — the convergence branch opens", async () => {
    // step 4 is the main chain…
    expect((await execution(fileId, "coordinator_reception"))?.state).toBe("AVAILABLE");
    // …and step 14 is the OTHER dependent of step 3. It is named by no narrative
    // list; C-1 promotes it because it DECLARES step 3 as its prerequisite. Its
    // reachability here is what makes the pickup convergence at step 15 possible
    // at all — the defect C-1 fixed left it PENDING forever.
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("AVAILABLE");
    // The transport-readiness pair hangs off step 3 too.
    expect((await execution(fileId, "bon_a_delivrer"))?.state).toBe("AVAILABLE");
    expect((await execution(fileId, "pre_gate"))?.state).toBe("AVAILABLE");

    await assertActivationAttributedTo("transport_assignment", am.id);
  });

  // --------------------------------------------------- 4. explicit reception ----

  it("the handoff to Transit is SENT — and sending does not open the step", async () => {
    const sent = await as(ops, () => handDossierToTransit(fileId));
    expect(sent.ok, `handoff: ${JSON.stringify(sent)}`).toBe(true);

    const rows = await handoffs(fileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].to_step_key).toBe("coordinator_reception");
    // UAT-WF-HANDOFF-01B: Operations owns this custody transfer, so Operations
    // is the recorded sender. The point of the assertion is unchanged — the
    // handoff names WHO handed the dossier over.
    expect(rows[0].sent_by).toBe(ops.id);
    expect(rows[0].received_by, "sending is not receiving").toBeNull();
  });

  it("step 4 — Transit RECEIVES explicitly; reception is its own act", async () => {
    const received = await as(transit, () => receiveDossierAtTransit(fileId));
    expect(received.ok, `reception: ${JSON.stringify(received)}`).toBe(true);

    const rows = await handoffs(fileId);
    expect(rows[0].status).toBe("RECEIVED");
    expect(rows[0].received_by, "the receiver is recorded").toBe(transit.id);
    expect(rows[0].received_by, "and is not the sender").not.toBe(rows[0].sent_by);

    await runStep(transit, "coordinator_reception");
    expect((await execution(fileId, "coordinator_reception"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "transit_declarant_assignment"))?.state).toBe("AVAILABLE");
  });

  // ------------------------------------------------ 5. declarant assignment ----

  it("step 5 — Transit assigns the customs work to a named person", async () => {
    // The assignment IS the step's product: step 6 must belong to somebody
    // before anyone can be said to be preparing it.
    //
    // It is assigned to the DÉCLARANT, which is what the registry says and what
    // production does: on EFT-IMP-2026-00011 the Chef assigned the Déclarant at
    // step 5 and the Déclarant prepared step 6.
    //
    // This slice used to assign step 6 to the CHIEF OF TRANSIT so that the
    // self-approval refusal below would be about IDENTITY rather than
    // permission — CHIEF_OF_TRANSIT holds customs:create AND customs:validate.
    // That proof is not lost: `negative-battery.journey.ts` performs exactly
    // it, with the same mechanics and the same comment. What it cost here was
    // the whole point of this slice — with the Chef as the maker, the Chef can
    // never be the checker, so the Chef's own validation surface was
    // unreachable and UAT-WF-STEP67-01 could hide behind a direct
    // `approveStep` call. Two distinct people, each in their registry role, is
    // both more faithful and what actually exercises the door.
    const assigned = await as(transit, () =>
      assignTransitStep(fileId, "customs_preparation", declarant.id),
    );
    expect(assigned.ok, `assign: ${JSON.stringify(assigned)}`).toBe(true);
    expect((await execution(fileId, "customs_preparation"))?.assigned_user_id).toBe(declarant.id);

    await runStep(transit, "transit_declarant_assignment");
    expect((await execution(fileId, "transit_declarant_assignment"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("AVAILABLE");
  });

  // -------------------------------------------------- 6. customs preparation ----

  it("step 6 refuses to close before the customs dossier exists", async () => {
    const started = await as(declarant, () => activateStep(fileId, "customs_preparation"));
    expect(started.ok, `activate step 6: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(declarant, () => submitStep(fileId, "customs_preparation"));
    expect(premature.ok, "step 6 must refuse without CUSTOMS_DOSSIER").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("ACTIVE");
  });

  it("step 6 SUBMITS for review rather than completing — it is a maker step", async () => {
    // CUSTOMS_DOSSIER is not an upload: it is satisfied by the existence of the
    // structured customs record, created through the action that owns it.
    const created = await as(declarant, () => createCustoms(fileId));
    expect(created.ok, `createCustoms: ${JSON.stringify(created)}`).toBe(true);

    // A declaration cannot be FILED while a prerequisite document is missing:
    // for a SEA shipment that is the commercial invoice, the packing list, the
    // customs declaration and the bill of lading (the AWB is dropped by mode).
    // Each must be VERIFIED, so each arrives the real way — uploaded by the
    // person preparing the step, verified by someone else.
    for (const code of ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "BILL_OF_LADING"]) {
      await provideEvidence(fileId, code, declarant, ops);
    }

    // The customs STATUS ladder is walked here, not later, because the control
    // gate says so: `customs.status` is owned by customs_preparation, so once
    // step 6 closes the record can no longer be moved. Release is legal only
    // from INSPECTION or DUTIES_ASSESSED, so the declaration must reach one of
    // them during preparation for step 13 to be reachable at all.
    const customsId = await customsIdFor(fileId);
    for (const status of ["DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED", "DUTIES_ASSESSED"]) {
      const moved = await as(declarant, () => changeCustomsStatus(customsId, status));
      expect(moved.ok, `customs -> ${status}: ${JSON.stringify(moved)}`).toBe(true);
    }

    // DEC-C38 — the Déclarant records the reference GAINDE handed him back.
    // His act, his column: `gainde_declaration_reference`.
    const declared = await as(declarant, () =>
      recordDeclarationReference(customsId, DECLARATION_REF),
    );
    expect(declared.ok, `declaration reference: ${JSON.stringify(declared)}`).toBe(true);

    // NOT WEAKENED — re-recording the SAME declaration reference is still
    // refused. That uniqueness is real: for THIS act the reference IS the deed.
    const again = await as(declarant, () =>
      recordDeclarationReference(customsId, DECLARATION_REF),
    );
    expect(again.ok, "a declaration reference may not be recorded twice").toBe(false);
    expect((again as { error: string }).error).toBe("reference_unchanged");

    // …and the production hazard, reproduced deliberately: the metadata form
    // lets step 6 write `external_ref`, which is FINANCE's column, and on
    // EFT-IMP-2026-00011 it held a value before Finance ever acted. With the
    // old guard that alone made step 9 unperformable. Set it to the SAME
    // string Finance will submit — the worst case, and the real one.
    const meta = await as(declarant, () =>
      updateCustoms(customsId, { externalRef: DECLARATION_REF }),
    );
    expect(meta.ok, `metadata external_ref: ${JSON.stringify(meta)}`).toBe(true);

    const submitted = await as(declarant, () => submitStep(fileId, "customs_preparation"));
    expect(submitted.ok, `submit step 6: ${JSON.stringify(submitted)}`).toBe(true);

    const exec = await execution(fileId, "customs_preparation");
    expect(exec?.state, "a reviewed step stops at SUBMITTED, never COMPLETED").toBe("SUBMITTED");
    expect(exec?.submitted_by).toBe(declarant.id);
    expect(exec?.completed_at, "nothing is complete until it is reviewed").toBeNull();
  });

  // ---------------------------------------------- 7. INDEPENDENT VALIDATION ----

  /**
   * UAT-WF-STEP67-01 — the CHECKER'S OWN DOOR must be open.
   *
   * This journey used to call `approveStep` directly, and that is why the
   * defect reached UAT: the engine was proven and the surface the Chef de
   * Transit actually presses was never exercised. That surface is
   * `recordCustomsValidation`, gated by `assertControlStep("customs.validation")`
   * — which reads the VALIDATOR step's row, finds PENDING (it cannot be
   * anything else while the review is outstanding, because its own
   * prerequisite is the preparer step it is reviewing) and refused every
   * checker forever with « Cette étape n'est pas encore ouverte. »
   *
   * So the gate is asserted on the real rows, before anybody validates.
   */
  it("6→7 the checker's control is OPEN while step 6 is SUBMITTED and step 7 PENDING", async () => {
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("SUBMITTED");
    expect(
      (await execution(fileId, "transit_validation"))?.state,
      "the validator row is PENDING for the whole review, by construction",
    ).toBe("PENDING");

    expect(
      await assertControlStep("customs.validation", fileId, transit.tenantId, transit.id),
      "a submitted maker must open its checker's control",
    ).toBeNull();

    // And the fix is NARROW: a PENDING step that is not the validator half of
    // a maker-checker pair is still refused, with the same sentence as before.
    expect(
      (await execution(fileId, "customs_field_clearance"))?.state,
      "step 13 has not been reached",
    ).toBe("PENDING");
    expect(
      await assertControlStep("customs.bae", fileId, transit.tenantId, transit.id),
      "an ordinary un-reached step gains nothing from this change",
    ).toBe("step_gate_step_not_open");
  });

  /**
   * UAT-BLOCKER-STEP67-PROD-02 — THE BROWSER'S PATH, not the action's.
   *
   * The previous slice fixed `assertControlStep` and the Chef's button stayed
   * disabled in production, because the dossier page does not call it: it calls
   * `getControlVerdicts`, which evaluates the step gate a SECOND time and fed
   * `disabled` and « Cette étape n'est pas encore ouverte. » straight into the
   * panel. One rule, two evaluators, one of them fixed. This asserts the one
   * the operator actually sees.
   */
  it("6→7 the DOSSIER PAGE renders the Chef's button ENABLED", async () => {
    const verdicts = await getControlVerdicts(
      PAGE_CUSTOMS_CONTROLS, fileId, transit.tenantId, transit.id, transit.roles ?? [],
    );

    expectRendersEnabled(verdicts, "customs.validation");
    expect(
      verdicts["customs.validation"].reasonFr,
      "the sentence the operator read must be gone",
    ).not.toBe("Cette étape n'est pas encore ouverte.");

    // The five governed customs elements are BLANK on this dossier, exactly as
    // on EFT-IMP-2026-00011, and none of them is a blocker.
    const rec = await customsGovernedElements(fileId);
    for (const col of [
      "sh_position_count", "declaration_type", "dpi_regime",
      "exemption_title_origin", "tariff_classification_origin",
    ]) {
      expect(rec?.[col] ?? null, `${col} must still be blank here`).toBeNull();
    }
    expect(verdicts["customs.validation"].allowed, "a blank governed element blocks nothing").toBe(true);

    // NARROW, on the very surface that was wrong: an un-reached step with no
    // maker-checker preparer is still refused, and still says NOT YET.
    const bae = verdicts["customs.bae"];
    expect(bae.allowed, "step 13 has not been reached").toBe(false);
    expect(bae.reasonCode).toBe("step_gate_step_not_open");
    expect(bae.reasonFr).toBe("Cette étape n'est pas encore ouverte.");

    // And the Déclarant — the maker — is offered nothing here. Refused on the
    // ROLE, and the control is not even drawn for them.
    const asMaker = await getControlVerdicts(
      PAGE_CUSTOMS_CONTROLS, fileId, declarant.tenantId, declarant.id, declarant.roles ?? [],
    );
    expect(asMaker["customs.validation"].allowed, "the maker may not validate").toBe(false);
    expect(asMaker["customs.validation"].isOwner, "and it is not drawn for them").toBe(false);
    expect(asMaker["customs.validation"].reasonCode).toBe("step_gate_not_owning_role");
  });

  it("6→7 the MAKER is refused at the panel and in the engine", async () => {
    const before = await execution(fileId, "customs_preparation");

    // The Déclarant prepared this. Here the refusal is about PERMISSION —
    // CUSTOMS_DECLARANT holds no `customs:validate` at all, and the door and
    // the engine must both say so. The IDENTITY case, where the maker DOES
    // hold both capabilities, is proven in `negative-battery.journey.ts`,
    // which assigns step 6 to the Chef precisely to demonstrate it.
    const refused = await as(declarant, () => approveStep(fileId, "transit_validation"));
    expect(refused.ok, "the preparer must not approve itself").toBe(false);
    expect((refused as { error: string }).error).toBe("forbidden");

    const customsId = await customsIdFor(fileId);
    const atTheDoor = await as(declarant, () => recordCustomsValidation(customsId));
    expect(atTheDoor.ok, "the Déclarant gains no validation authority").toBe(false);
    expect((atTheDoor as { error: string }).error).toBe("forbidden");

    // Nothing moved: not the preparer step, not the validator step.
    const after = await execution(fileId, "customs_preparation");
    expect(after?.state, "state must be unchanged after refusal").toBe("SUBMITTED");
    expect(after?.completed_at).toBeNull();
    expect(after?.reviewed_by, "a refused review may record no reviewer").toBeNull();
    expect(after?.submitted_by).toBe(before?.submitted_by);
    expect((await execution(fileId, "transit_validation"))?.state).not.toBe("COMPLETED");
  });

  it("…and holding customs:validate is NOT holding the Chef's seat", async () => {
    // Operations holds `customs:validate` for other acts and is refused this
    // control on OWNERSHIP — the ratified narrowing of
    // OPS-CUSTOMS-OWNERSHIP-01. Asserted here because opening the step gate
    // must not be mistaken for opening the door: the second condition still
    // stands, and it stands on the ROLE the registry names.
    const customsId = await customsIdFor(fileId);
    const refused = await as(ops, () => recordCustomsValidation(customsId));
    expect(refused.ok, "broad privilege is not this seat").toBe(false);
    expect((refused as { error: string }).error).toBe("step_gate_not_owning_role");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("SUBMITTED");
  });

  it("step 7 — the CHEF's control completes both steps and opens step 8", async () => {
    // The operator's act, not the engine's. One press certifies the customs
    // record AND closes the maker-checker pair; before this slice it did only
    // the first, so step 6 stayed SUBMITTED and step 8 never opened.
    const customsId = await customsIdFor(fileId);
    const approved = await as(transit, () => recordCustomsValidation(customsId));
    expect(approved.ok, `validate: ${JSON.stringify(approved)}`).toBe(true);

    // ATTR-CUSTOMS-01 — the certification names the Chef, on the record AND in
    // the ledger. Every later customs act in step 13 must leave both untouched.
    const validated = await customsReleaseState(fileId);
    expect(validated?.reviewed_by, "reviewed_by is the step 7 validator").toBe(transit.id);
    expect(validated?.reviewed_at, "…with the instant of the validation").toBeTruthy();
    step7ReviewedAt = (validated?.reviewed_at as string | null) ?? null;
    expect(await customsEventActor(customsId, "CUSTOMS_VALIDATED")).toBe(transit.id);

    const prep = await execution(fileId, "customs_preparation");
    expect(prep?.state).toBe("COMPLETED");
    expect(prep?.reviewed_by, "the reviewer is recorded").toBe(transit.id);
    expect(prep?.reviewed_by, "and is NOT the maker").not.toBe(prep?.submitted_by);

    expect((await execution(fileId, "transit_validation"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "coordinator_to_finance"))?.state).toBe("AVAILABLE");

    const events = await auditFor("process.step.approved", prep!.id as string);
    expect(events.length, "the approval must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id).toBe(transit.id);
  });

  // ------------------------------------------------------ 8–13 GAINDE / BAE ----

  it("step 8 — Coordination hands the dossier to Finance douane", async () => {
    await runStep(coordinator, "coordinator_to_finance");
    expect((await execution(fileId, "coordinator_to_finance"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "gainde_registration"))?.state).toBe("AVAILABLE");
    await assertActivationAttributedTo("gainde_registration", coordinator.id);

    // Completing the step moves the engine; it does not deliver the dossier.
    // Finance douane can only reach it once the handoff is sent AND received.
    await handOver(coordinator, customsFinance, "coordinator_to_finance", "gainde_registration");
  });

  it("step 9 — nobody without customs:register may record a payment", async () => {
    // BEFORE Finance acts, deliberately. Once step 9 closes, Finance douane
    // itself loses sight of the dossier (migrations 121/122), so EVERY actor
    // is refused `forbidden` from then on — and a refusal that would happen
    // anyway proves nothing about the permission it claims to test.
    const customsId = await customsIdFor(fileId);
    const before = await gaindePayments(fileId);
    expect(before.all, "no payment exists yet").toHaveLength(0);

    for (const actor of [declarant, coordinator, transit]) {
      const refused = await as(actor, () =>
        recordGaindeRegistration(customsId, DECLARATION_REF, gaindeTaxPayment(`Q-NO-${Date.now()}`)),
      );
      expect(refused.ok, `${actor.id} must not record a Finance payment`).toBe(false);
      // `assertPermission` is the first thing the action does, so this is the
      // capability talking and not visibility.
      expect((refused as { error: string }).error).toBe("forbidden");
    }

    const after = await gaindePayments(fileId);
    expect(after.all, "no refused attempt left a row behind").toHaveLength(0);
  });

  /**
   * UAT-STEP9-FINANCE-01 — THE EXACT CONDITION THAT BLOCKED PRODUCTION.
   *
   * Step 6 recorded a declaration reference and `external_ref` already holds
   * it. Finance now pays the duties AGAINST that declaration, submitting the
   * same reference — which is what the business does and what the form
   * defaults to. Before #142 this was refused « Cette référence GAINDE est
   * déjà enregistrée » and step 9 could never be performed.
   */
  it("step 9 — Finance pays AGAINST the existing step-6 declaration", async () => {
    const customsId = await customsIdFor(fileId);
    const before = await gaindePayments(fileId);
    expect(before.live, "Finance has not paid yet").toHaveLength(0);

    const quittance = `Q-JRN-${Date.now()}`;
    const registered = await as(customsFinance, () =>
      recordGaindeRegistration(customsId, DECLARATION_REF, gaindeTaxPayment(quittance)),
    );
    expect(
      registered.ok,
      `Finance must be able to pay against the existing declaration: ${JSON.stringify(registered)}`,
    ).toBe(true);

    // ONE live payment, attached to this customs record, attributed to Finance.
    const after = await gaindePayments(fileId);
    expect(after.live, "exactly one live payment").toHaveLength(1);
    const payment = after.live[0];
    expect(payment.quittance_reference).toBe(quittance);
    expect(payment.paid_by).toBe(customsFinance.id);

    // The breakdown is stored, and the total is the sum of its lines — the
    // arithmetic the constraint trigger holds, asserted from the rows.
    const lines = await gaindePaymentLines(payment.id as string);
    expect(lines).toHaveLength(6);
    const sum = lines.reduce((t, l) => t + Number(l.amount_minor), 0);
    expect(Number(payment.total_paid_minor)).toBe(sum);

    // THE DECLARATION IS NOT RECREATED. Finance's act writes Finance's column
    // and the milestone; the Déclarant's reference is exactly as he left it.
    const rec = await customsRecordRefs(fileId);
    expect(rec?.gainde_declaration_reference, "step 6's fact is untouched").toBe(DECLARATION_REF);
    expect(rec?.gainde_registered_by, "the milestone names Finance").toBe(customsFinance.id);
    expect(rec?.gainde_registered_at).toBeTruthy();

    // Step 9 carries no required documents: the milestone IS its completion, and
    // MAYA-P1.2 tightened the rule so that only FINANCE's own registration fact
    // proves it. So Finance does not "close a step" afterwards — recording the
    // registration is the act, and reconciliation converges the engine onto it.
    const s9 = await execution(fileId, "gainde_registration");
    expect(s9?.state).toBe("COMPLETED");
    expect(s9?.completion_provenance).toBe("RECONCILED");

    // …and, being a reconciled completion, it promotes — which before this
    // slice's fix it did not.
    expect((await execution(fileId, "coordinator_to_declarant"))?.state).toBe("AVAILABLE");
    // The reconciled promotion is audited and attributed to the actor whose
    // fact caused it (F-α). Proven here now that step 3 — the old vehicle for
    // this guarantee — is no longer fact-provable.
    await assertActivationAttributedTo("coordinator_to_declarant", customsFinance.id);
  });

  it("step 9 — an IDENTICAL resubmission is refused, and the ledger does not churn", async () => {
    // What step 9 actually has to refuse: the same receipt, the same instant,
    // the same total, already live. A double click, not a second payment.
    //
    // Asserted against the RPC DIRECTLY, because that is where the guard lives
    // and because the app layer can no longer reach it: completing step 9
    // ends Finance douane's visibility of the dossier, so a call through
    // `recordGaindeRegistration` here would be refused `forbidden` before it
    // ever got near the duplicate check — a pass for the wrong reason.
    const customsId = await customsIdFor(fileId);
    const live = (await gaindePayments(fileId)).live;
    expect(live).toHaveLength(1);

    const payment = gaindeTaxPayment(live[0].quittance_reference as string);
    const { error } = await db().rpc("record_gainde_registration", {
      p_customs_id: customsId,
      p_reference: DECLARATION_REF,
      p_actor: customsFinance.id,
      p_paid_at: payment.paidAt,
      p_currency: payment.currency,
      p_quittance: payment.quittance,
      p_lines: payment.lines,
    } as never);
    expect(error, "an identical live payment must be refused").toBeTruthy();
    expect((error?.message ?? "").split(":")[0].trim()).toBe("payment_unchanged");

    const after = await gaindePayments(fileId);
    expect(after.live, "still exactly one live payment").toHaveLength(1);
    expect(after.all, "and nothing was voided or re-written").toHaveLength(1);
    expect(after.live[0].id).toBe(live[0].id);
  });

  it("once step 9 closes, Finance douane correctly stops seeing the dossier", async () => {
    // Not a defect — the two grounds that let Finance reach this dossier are
    // both narrow on purpose. Handoff-receiver visibility EXPIRES ON RECEPTION
    // (migration 121), and owning-role visibility covers only an OPEN
    // UNASSIGNED step (migration 122). With step 9 completed, neither applies,
    // so Finance can no longer act on a dossier it has finished with.
    const late = await as(customsFinance, () => activateStep(fileId, "gainde_registration"));
    expect(late.ok).toBe(false);
    expect((late as { error: string }).error).toBe("forbidden");
  });

  it("the Finance clearance handoff (9-10) cannot hit the C-2 guard", async () => {
    // clearFinance sends gainde_registration -> coordinator_to_declarant and
    // degrades to a Coordinator notification if the send is refused. The
    // question is whether that fallback is deliberate or permanent.
    //
    // C-2 refuses a handoff for exactly one reason: the from-step is not done.
    // So the question is decidable here, without invoking clearFinance's own
    // clearance gate: by the time any Finance clearing can run, step 9 has
    // already been completed by Finance's own registration fact. The guard
    // therefore cannot be what triggers the fallback.
    const s9 = await execution(fileId, "gainde_registration");
    expect(s9?.state, "step 9 is done before any Finance clearing").toBe("COMPLETED");
    expect(s9?.completion_provenance).toBe("RECONCILED");

    // NOT proved here: that clearFinance's OTHER preconditions
    // (evaluateClearanceLive) are satisfiable in this journey. The fallback may
    // still be reached for a different reason, which is a separate question
    // from the C-2 regression and is recorded rather than assumed away.
  });

  /**
   * UAT-STEP10-HANDOFF-01 — WHAT THE COORDINATOR ACTUALLY SEES after step 9.
   *
   * This journey drove step 10 straight through `activateStep`/`submitStep`
   * and never read the surface, so it stayed green for weeks while the
   * dossier page rendered step 10 « Bloquée » with « Le dossier doit d'abord
   * être formellement transmis au service suivant. » and the Coordinator had
   * no button at all. The engine was right; the read model was not. So this
   * asserts the RENDERED verdict, through the same `getDossierWork` the
   * dossier page and /process both call — before any action is taken.
   */
  it("step 10 — the Coordinator SEES an actionable step, not « Bloquée »", async () => {
    expect((await execution(fileId, "coordinator_to_declarant"))?.state).toBe("AVAILABLE");

    const view = await getDossierWork(fileId, {
      tenantId: coordinator.tenantId,
      userId: coordinator.id,
      permissions: await permissionsOf(coordinator.id),
      roles: coordinator.roles ?? [],
    });
    const step10 = view?.dossier.steps.find((n) => n.facts.stepKey === "coordinator_to_declarant");
    expect(step10, "step 10 must be part of the dossier's work").toBeTruthy();

    // The verdict the page renders, from the same evaluator the page uses.
    const el = evaluateStepAction(step10!.facts, {
      userId: coordinator.id,
      permissions: await permissionsOf(coordinator.id),
      roles: coordinator.roles ?? [],
    });
    expect(el.canStart, `step 10 must be startable: ${JSON.stringify(el)}`).toBe(true);
    expect(el.custodyRefusal, "no custody transfer is owed here").toBeNull();
    expect(el.reasonFr).toBeNull();

    const status = contextualStatus("AVAILABLE", el);
    expect(status.labelFr).not.toBe("Bloquée");
    expect(status.key).toBe("a_votre_tour");

    // And the Déclarant is not offered step 11 yet — governance intact.
    const asDeclarant = await getDossierWork(fileId, {
      tenantId: declarant.tenantId,
      userId: declarant.id,
      permissions: await permissionsOf(declarant.id),
      roles: declarant.roles ?? [],
    });
    const s11 = asDeclarant?.dossier.steps.find(
      (n) => n.facts.stepKey === "gainde_document_submission",
    );
    const s11el = s11
      ? evaluateStepAction(s11.facts, {
          userId: declarant.id,
          permissions: await permissionsOf(declarant.id),
          roles: declarant.roles ?? [],
        })
      : null;
    expect(s11el?.canStart ?? false, "step 11 is not open yet").toBe(false);
  });

  it("step 10 — Coordination hands it back to the declarant", async () => {
    await runStep(coordinator, "coordinator_to_declarant");
    expect((await execution(fileId, "coordinator_to_declarant"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "gainde_document_submission"))?.state).toBe("AVAILABLE");

    await handOver(coordinator, declarant, "coordinator_to_declarant", "gainde_document_submission");
  });

  /**
   * UAT-STEP11-RECONCILE-01 — THE DOOR THE DÉCLARANT ACTUALLY USES.
   *
   * This journey satisfied step 11 by UPLOADING a
   * `GAINDE_SUBMISSION_EVIDENCE` document and never recorded the rattachement
   * — so it proved the one route production does not take. On
   * EFT-IMP-2026-00011 the Déclarant pressed « Enregistrer le rattachement —
   * GAINDE + ORBUS », the act landed, and the step went on demanding a
   * document nobody had asked him for. The act is the ratified proof
   * (MAYA-P1.11, migration 20260828000001); it is now what this journey uses.
   */
  it("step 11 — the declarant cannot close without the rattachement", async () => {
    const started = await as(declarant, () => activateStep(fileId, "gainde_document_submission"));
    expect(started.ok, `activate step 11: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(declarant, () => submitStep(fileId, "gainde_document_submission"));
    expect(premature.ok).toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    // …and the SURFACE says the same thing, in the operator's words.
    const before = await stepEligibility(fileId, "gainde_document_submission", declarant);
    expect(before?.canSubmit, "no rattachement, no completion").toBe(false);
    expect(before?.reasonFr).toContain("Preuve d'introduction des documents dans GAINDE");
  });

  it("step 11 — recording the rattachement IS the evidence, and closes the step", async () => {
    const customsId = await customsIdFor(fileId);
    const recorded = await as(declarant, () =>
      recordCustomsAttachment(customsId, ["GAINDE", "ORBUS"]),
    );
    expect(recorded.ok, `rattachement: ${JSON.stringify(recorded)}`).toBe(true);

    // The governed fact is on the record, attributed and dated — and NEITHER
    // step 6's declaration reference NOR step 9's payment moved with it.
    const refs = await customsRecordRefs(fileId);
    expect(refs?.gainde_declaration_reference, "step 6 untouched").toBe(DECLARATION_REF);
    expect(refs?.gainde_registered_at, "step 9 untouched").toBeTruthy();
    expect((await gaindePayments(fileId)).live, "one live payment, unchanged").toHaveLength(1);

    // The step closes by CONVERGENCE, because the act triggers reconciliation —
    // no upload, and no second human click needed.
    const s11 = await execution(fileId, "gainde_document_submission");
    expect(s11?.state, `step 11: ${JSON.stringify(s11)}`).toBe("COMPLETED");
    expect((await execution(fileId, "customs_followup"))?.state).toBe("AVAILABLE");
  });

  /**
   * UAT-STEP12-FIELD-AGENT-01 — step 12's ratified output, through its door.
   *
   * `runStep` used to close step 12 with nobody named, and step 13 opened
   * unassigned — the governed « affecter l'Agent de Terrain » responsibility
   * skipped in silence, and step 13's ownership left to whoever claimed it.
   */
  it("step 12 — refuses to close until an Agent de Terrain is named", async () => {
    const started = await as(coordinator, () => activateStep(fileId, "customs_followup"));
    expect(started.ok, `activate step 12: ${JSON.stringify(started)}`).toBe(true);

    expect(
      (await execution(fileId, "customs_field_clearance"))?.assigned_user_id,
      "nobody is named yet",
    ).toBeNull();

    const premature = await as(coordinator, () => submitStep(fileId, "customs_followup"));
    expect(premature.ok, "step 12 must refuse without a Field Agent").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    // …and the SURFACE says so too, in the operator's words.
    const el = await stepEligibility(fileId, "customs_followup", coordinator);
    expect(el?.canSubmit).toBe(false);
    expect(el?.reasonFr).toContain("Agent de Terrain");
  });

  it("step 12 — the Coordinator names the Agent de Terrain, then closes it", async () => {
    // THE ASSIGNMENT DOOR: the one canonical writer, called exactly as the
    // panel calls it. Not an execution-row write, not a second path.
    const assigned = await as(coordinator, () =>
      assignTransitStep(fileId, "customs_field_clearance", field.id),
    );
    expect(assigned.ok, `assign field agent: ${JSON.stringify(assigned)}`).toBe(true);

    const s13 = await execution(fileId, "customs_field_clearance");
    expect(s13?.assigned_user_id, "step 13 is bound to the named agent").toBe(field.id);

    // The act is audited, and names BOTH sides of the move.
    const events = await auditFor("process.step.assigned", s13!.id as string);
    expect(events.length, "the assignment must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id, "attributed to the Coordinator").toBe(coordinator.id);

    // Now — and only now — step 12 may close.
    const done = await as(coordinator, () => submitStep(fileId, "customs_followup"));
    expect(done.ok, `submit step 12: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "customs_followup"))?.state).toBe("COMPLETED");

    // Step 13 opens, and it is STILL the named agent's.
    const opened = await execution(fileId, "customs_field_clearance");
    expect(opened?.state).toBe("AVAILABLE");
    expect(opened?.assigned_user_id, "promotion must not clear the assignment").toBe(field.id);

    // Another field agent cannot take it.
    const stolen = await as(declarant, () => activateStep(fileId, "customs_field_clearance"));
    expect(stolen.ok, "governed ownership is not claimable by anybody else").toBe(false);
  });

  it("step 13 — clearance refuses without a BAE, then the release closes it", async () => {
    const started = await as(field, () => activateStep(fileId, "customs_field_clearance"));
    expect(started.ok, `activate step 13: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(field, () => submitStep(fileId, "customs_field_clearance"));
    expect(premature.ok, "no BON_A_ENLEVER without a BAE reference").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    // BON_A_ENLEVER is not an upload: it is the BAE reference on the customs
    // record, recorded by the person who CLAIMED this step. Not by the chief of
    // transit — `customs.release` is gated on customs_field_clearance, and the
    // field agent holds it, so anyone else would be refused assigned_to_another.
    const bae = await as(field, () => recordBae(fileId, `BAE-JRN-${Date.now()}`));
    expect(bae.ok, `recordBae: ${JSON.stringify(bae)}`).toBe(true);

    // ATTR-CUSTOMS-01 — the recorder is the field agent, on the record and in
    // the ledger. The trigger used to name whoever held reviewed_by: the Chef.
    const customsId = await customsIdFor(fileId);
    await expectCustomsAttribution("after the BAE", { recorder: field.id, approver: null, finaliser: null });
    expect(
      await customsEventActor(customsId, "BAE_RECORDED"),
      "BAE_RECORDED names its recorder, not the step 7 validator",
    ).toBe(field.id);

    // TRANSIT-CUSTODY-05 — recording is not releasing. The reference and its
    // author are on file, the verification is open, and the step stays open too.
    const recorded = await customsReleaseState(fileId);
    expect(recorded?.release_approval_status).toBe("PENDING");
    expect(recorded?.bae_recorded_by).toBeTruthy();
    expect(recorded?.status).not.toBe("RELEASED");
    expect((await execution(fileId, "customs_field_clearance"))?.state).not.toBe("COMPLETED");

    // STEP13-COMPLETION-01 — PRESS THE DANGEROUS DOOR, don't just observe it.
    //
    // This journey used to check only that step 13 HAPPENED not to be completed
    // after the BAE. It never tried. On EFT-IMP-2026-00011 that exact moment
    // offered « Terminer », and `submitStep` would have accepted it on the BAE
    // reference alone — closing the release control, after which the release
    // could never be recorded at all.
    const earlyTerminer = await as(field, () => submitStep(fileId, "customs_field_clearance"));
    expect(earlyTerminer.ok, "step 13 must not close on a BAE with the verification PENDING").toBe(false);
    expect((earlyTerminer as { error: string }).error).toBe("evidence_missing");
    expect(
      ((earlyTerminer as { missing?: { key: string }[] }).missing ?? []).map((m) => m.key),
      "the refusal names the release, not the BAE that is already on file",
    ).toEqual(["CUSTOMS_RELEASE"]);
    // …and the surface agrees: no « Terminer », and it says what is missing.
    const surface = await stepEligibility(fileId, "customs_field_clearance", field);
    expect(surface?.canSubmit, "the UI must not offer Terminer").toBe(false);
    expect(surface?.reasonFr).toBe("Action requise : Mainlevée finalisée.");
    expect((await execution(fileId, "customs_field_clearance"))?.state).toBe("ACTIVE");

    // The field agent who obtained the mainlevée may not verify it. Refused on
    // the SEAT — the field agent holds neither `customs:validate` nor the Chef's
    // role — so this does not reach the database's maker/checker guard, which
    // stands behind it for actors who hold both and is unreachable in the normal
    // flow precisely because the control gate binds recording to the claimant.
    const selfCheck = await as(field, () => decideTransitRelease(fileId, "APPROVED"));
    expect(selfCheck.ok).toBe(false);

    // Nor may Operations, which holds `customs:validate` for other acts: the
    // seat is the Chef de Transit's.
    const opsCheck = await as(ops, () => decideTransitRelease(fileId, "APPROVED"));
    expect(opsCheck.ok, "Operations must not be a normal approver").toBe(false);
    expect((opsCheck as { error: string }).error).toBe("not_authorized_approver");

    // And the release itself is refused while the verdict is outstanding.
    const early = await as(field, () => finalizeTransitRelease(fileId));
    expect(early.ok).toBe(false);
    expect((early as { error: string }).error).toBe("release_not_approved");

    // A refusal must carry a motif — the record has to say WHY the goods were
    // held, or the refusal is unaccountable.
    const noMotif = await as(transit, () => decideTransitRelease(fileId, "REJECTED"));
    expect(noMotif.ok).toBe(false);
    expect((noMotif as { error: string }).error).toBe("reason_required");

    // A reasoned refusal is recorded, and the release stays blocked by it.
    const refused = await as(transit, () =>
      decideTransitRelease(fileId, "REJECTED", "Référence illisible sur le BAE."));
    expect(refused.ok, `refusal: ${JSON.stringify(refused)}`).toBe(true);
    await expectCustomsAttribution("after the refusal", { recorder: field.id, approver: transit.id, finaliser: null });
    const stillBlocked = await as(field, () => finalizeTransitRelease(fileId));
    expect((stillBlocked as { error: string }).error).toBe("release_not_approved");
    const refusedState = await customsReleaseState(fileId);
    expect(refusedState?.release_approval_status).toBe("REJECTED");
    expect(refusedState?.release_approval_note).toContain("illisible");

    // A REJECTED verification is not a release either.
    const afterRejection = await as(field, () => submitStep(fileId, "customs_field_clearance"));
    expect(afterRejection.ok, "a refused BAE must not let step 13 close").toBe(false);
    expect((afterRejection as { error: string }).error).toBe("evidence_missing");

    // Correcting the mainlevée reopens the verification rather than inheriting
    // the refusal — the field agent can answer the Chef and be looked at again.
    const corrected = await as(field, () => recordBae(fileId, `BAE-JRN-2-${Date.now()}`));
    expect(corrected.ok, `re-record: ${JSON.stringify(corrected)}`).toBe(true);
    // A correction reopens the verification (the refusal's approver is cleared)
    // and is a REPLACEMENT, not a second first-recording.
    await expectCustomsAttribution("after the BAE correction", { recorder: field.id, approver: null, finaliser: null });
    expect(await customsEventCount(customsId, "BAE_RECORDED")).toBe(1);
    expect(await customsEventActor(customsId, "BAE_RECORDED")).toBe(field.id);

    const verdict = await as(transit, () => decideTransitRelease(fileId, "APPROVED"));
    expect(verdict.ok, `release approval: ${JSON.stringify(verdict)}`).toBe(true);
    await expectCustomsAttribution("after the approval", { recorder: field.id, approver: transit.id, finaliser: null });
    expect(await customsEventActor(customsId, "CUSTOMS_RELEASE_APPROVED")).toBe(transit.id);

    // APPROVED is a verdict, not a release: until the field agent finalizes,
    // customs is not RELEASED and step 13 still may not close.
    const afterApproval = await as(field, () => submitStep(fileId, "customs_field_clearance"));
    expect(afterApproval.ok, "an approved but unfinalized release must not let step 13 close").toBe(false);
    expect((afterApproval as { error: string }).error).toBe("evidence_missing");
    expect((await customsReleaseState(fileId))?.status).not.toBe("RELEASED");
    // The ratified control is intact: the Chef holds `customs:release` and is
    // STILL refused the finalisation, because step 13 is claimed by the field
    // agent. Approving does not hand the Chef the release — it unblocks it for
    // the person whose step it is. This can fail for no other reason.
    const chefFinalize = await as(transit, () => finalizeTransitRelease(fileId));
    expect(chefFinalize.ok, "the Chef must not be able to finalise").toBe(false);
    await expectCustomsAttribution("after the Chef's refused finalisation", { recorder: field.id, approver: transit.id, finaliser: null });

    const finalized = await as(field, () => finalizeTransitRelease(fileId));
    expect(finalized.ok, `finalize release: ${JSON.stringify(finalized)}`).toBe(true);
    const released = await customsReleaseState(fileId);
    expect(released?.status).toBe("RELEASED");
    expect(released?.release_approval_status).toBe("APPROVED");

    // ATTR-CUSTOMS-01 — THE DEFECT. Finalising used to write reviewed_by = the
    // field agent. It stays the Chef; the finaliser has its own column, and the
    // ledger names each act's own author.
    await expectCustomsAttribution("after the release", { recorder: field.id, approver: transit.id, finaliser: field.id });
    expect(await customsEventActor(customsId, "CUSTOMS_RELEASE_COMPLETED")).toBe(field.id);
    expect(await customsEventActor(customsId, "CUSTOMS_STATUS_CHANGED")).toBe(field.id);
    expect(await customsEventActor(customsId, "CUSTOMS_VALIDATED")).toBe(transit.id);
    expect(await customsEventCount(customsId, "CUSTOMS_VALIDATED")).toBe(1);

    // The release IS the fact that proves this step, so reconciliation closes it
    // — and now promotes from it.
    const s13 = await execution(fileId, "customs_field_clearance");
    expect(s13?.state).toBe("COMPLETED");
    expect(s13?.completion_provenance).toBe("RECONCILED");
    // …and reconciliation re-attributes nothing.
    await expectCustomsAttribution("after reconciliation", { recorder: field.id, approver: transit.id, finaliser: field.id });
  });

  // --------------------------------------------------------- convergence ----

  it("steps 4–13 are COMPLETED, and step 15 still waits for its other branch", async () => {
    const chain = [
      "coordinator_reception", "transit_declarant_assignment", "customs_preparation",
      "transit_validation", "coordinator_to_finance", "gainde_registration",
      "coordinator_to_declarant", "gainde_document_submission", "customs_followup",
      "customs_field_clearance",
    ];
    for (const key of chain) {
      expect((await execution(fileId, key))?.state, `${key} must be COMPLETED`).toBe("COMPLETED");
    }

    // Step 15 declares BOTH customs_field_clearance and transport_assignment.
    // The customs branch has landed; the transport branch has not, so pickup
    // must still be closed. Asserted rather than assumed — slice 3 lands the
    // other branch and opens it.
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("AVAILABLE");
    expect(
      (await execution(fileId, "pickup"))?.state,
      "pickup must wait for the transport branch",
    ).toBe("PENDING");

    const blocked = await as(field, () => activateStep(fileId, "pickup"));
    expect(blocked.ok, "pickup cannot open on one branch alone").toBe(false);
  });
});

/**
 * C-4 — the OTHER completion path, proved end to end.
 * ---------------------------------------------------------------------------
 * Slice 2 above proves reconciliation no longer completes a step on a weak
 * proxy. This block proves the other half: once the step's own evidence really
 * is satisfied, reconciliation may complete it — and when it does, it opens
 * what waits on it, through the same promotion authority the action path uses.
 *
 * Its own dossier, so the assertions are about reconciliation and nothing else.
 */
describe("C-4 — a RECONCILED completion promotes its dependents", () => {
  let reconFile = "";

  beforeAll(async () => {
    const created = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY RECON",
          destination: "Dakar",
          blAwbRef: `JRN-RECON-${Date.now()}`,
        },
      }),
    );
    if (!created.ok) throw new Error(`recon dossier creation failed: ${JSON.stringify(created)}`);
    reconFile = (created as { id: string }).id;

    // OPS-OWNERSHIP-01 (K3) — designate the Responsable client BEFORE opening:
    // the opening act completes step 2 only when that governed designation
    // exists. This is the ratified sequence, not test scaffolding.
    await as(ops, () => assignCommercialOwner({ fileId: reconFile, userId: am.id, reasonCode: "INITIAL" }));
    const opened = await as(ops, () =>
      openDossierWorkflow(reconFile, { ownerUserId: ops.id, skipCotation: true }),
    );
    if (!opened.ok) throw new Error(`recon workflow open failed: ${JSON.stringify(opened)}`);

    // H-1: the opening act already completed step 2.
    const started = await as(am, () => activateStep(reconFile, "am_dossier_opening"));
    if (!started.ok) throw new Error(`recon step 3 activate failed: ${JSON.stringify(started)}`);
  });

  it("reconciliation never closes step 3 — readiness is the Account Manager's act", async () => {
    // H-1/H-2 (2026-09-03). Step 3's fact rule asked only whether the dossier
    // had left DRAFT, and was held back solely by its four required documents.
    // Those were ratified away, so the proxy was REMOVED rather than left
    // standing alone: otherwise verifying any document on any opened dossier
    // would have completed the Account Manager's readiness act for them.
    await provideEvidence(reconFile, "BORDEREAU_LIVRAISON", am, ops);
    await provideEvidence(reconFile, "TRANSPORT_REQUEST", am, ops);

    const exec = await execution(reconFile, "am_dossier_opening");
    expect(exec?.state, "no document verification may close step 3").toBe("ACTIVE");
    expect(exec?.completion_provenance, "nothing was reconciled").toBeNull();
    // …and nothing downstream was opened on the strength of it.
    expect((await execution(reconFile, "transport_assignment"))?.state).toBe("PENDING");
  });

  it("the Account Manager's own completion promotes every dependent", async () => {
    // The C-1 guarantee, unchanged and still proven against a real database —
    // only its driver moved. It used to be reached by reconciliation; step 3 is
    // no longer fact-provable, so the human act drives it, which is the point.
    const done = await as(am, () => submitStep(reconFile, "am_dossier_opening"));
    expect(done.ok, `step 3: ${JSON.stringify(done)}`).toBe(true);

    const exec = await execution(reconFile, "am_dossier_opening");
    expect(exec?.state).toBe("COMPLETED");
    expect(exec?.completion_provenance, "a human act, never RECONCILED").not.toBe("RECONCILED");

    // THE DEFECT: this used to stay PENDING forever, with no other path to
    // AVAILABLE, which made the whole transport-readiness branch unreachable.
    expect((await execution(reconFile, "transport_assignment"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "bon_a_delivrer"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "pre_gate"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "coordinator_reception"))?.state).toBe("AVAILABLE");
  });

  it("the promotion is audited and attributed to the causing actor", async () => {
    const exec = await execution(reconFile, "transport_assignment");
    const events = await auditFor("process.step.activated", exec!.id as string);
    expect(events.length, "a promotion is never unaudited").toBeGreaterThan(0);
    // The AM completed step 3, so the AM is the principal — F-α, unchanged.
    expect(events[0].actor_id).toBe(am.id);

    // …and it is NOT recorded as machine-caused, because a real actor caused it.
    const systemEvents = await auditFor("system.process.step.activated", exec!.id as string);
    expect(systemEvents, "a human-caused promotion must not hide behind system").toHaveLength(0);
  });

  it("promotion is exactly once, and only when the LAST prerequisite lands", async () => {
    // pickup waits on customs_field_clearance AND transport_assignment. Only the
    // transport branch has opened (not even completed), so pickup stays shut.
    expect((await execution(reconFile, "pickup"))?.state).toBe("PENDING");

    // Re-running reconciliation is idempotent: the step is already COMPLETED, so
    // the RPC reports `already` and no second promotion is attempted. The
    // promotion audit count must not grow.
    const exec = await execution(reconFile, "transport_assignment");
    const before = (await auditFor("process.step.activated", exec!.id as string)).length;
    await provideEvidence(reconFile, "BORDEREAU_LIVRAISON", am, ops);
    const after = (await auditFor("process.step.activated", exec!.id as string)).length;
    expect(after, "a repeated reconciliation must not promote twice").toBe(before);
    expect((await execution(reconFile, "transport_assignment"))?.state).toBe("AVAILABLE");
  });
});
