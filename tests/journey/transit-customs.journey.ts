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
  identity, execution, auditFor, handoffs, provideEvidence, customsIdFor,
  CLIENT_DEPOSIT_REQUIRED,
} from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae } from "@/lib/process/engine/transit-actions";
import { createCustoms, recordGaindeRegistration, changeCustomsStatus } from "@/lib/customs/actions";

let ops: CurrentUser;            // OPS_SUPERVISOR — customs:validate (independent checker)
let am: CurrentUser;             // ACCOUNT_MANAGER
let transit: CurrentUser;        // CHIEF_OF_TRANSIT — customs:create AND customs:validate
let declarant: CurrentUser;      // CUSTOMS_DECLARANT — customs:create/update, NO customs:validate
let coordinator: CurrentUser;    // COORDINATOR — the handoff steps
let customsFinance: CurrentUser; // CUSTOMS_FINANCE_OFFICER — customs:register
let field: CurrentUser;          // CUSTOMS_FIELD_AGENT — customs:release

let fileId = "";

/** Drive one step the way an operator does: claim it, then close it. */
async function runStep(actor: CurrentUser, stepKey: string) {
  const started = await as(actor, () => activateStep(fileId, stepKey));
  expect(started.ok, `activate ${stepKey}: ${JSON.stringify(started)}`).toBe(true);
  const done = await as(actor, () => submitStep(fileId, stepKey));
  expect(done.ok, `submit ${stepKey}: ${JSON.stringify(done)}`).toBe(true);
  return done;
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

    const opened = await as(ops, () =>
      openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }),
    );
    if (!opened.ok) throw new Error(`slice 2 workflow open failed: ${JSON.stringify(opened)}`);
  });

  // ------------------------------------------------------- reaching step 4 ----

  it("steps 2 and 3 complete on real evidence, opening the road to Transit", async () => {
    const s2 = await as(ops, () => submitStep(fileId, "operations_intake"));
    expect(s2.ok, `step 2: ${JSON.stringify(s2)}`).toBe(true);
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
    const sent = await as(am, () => handDossierToTransit(fileId));
    expect(sent.ok, `handoff: ${JSON.stringify(sent)}`).toBe(true);

    const rows = await handoffs(fileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].to_step_key).toBe("coordinator_reception");
    expect(rows[0].sent_by).toBe(am.id);
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
    // It is assigned to the CHIEF OF TRANSIT deliberately, and that is the only
    // unusual choice in this slice. Step 6 is normally the declarant's. But the
    // maker-checker proof below needs a preparer who ALSO holds customs:validate
    // — otherwise the forbidden self-approval is refused for lack of permission,
    // which proves permission gating and says nothing about maker ≠ checker.
    // CHIEF_OF_TRANSIT legitimately holds both, so it is the one identity that
    // can demonstrate the rule approveStep actually claims: a supervisor who
    // happens to hold both permissions still cannot approve their own work.
    // The declarant's refusal is asserted separately, so both remain proven.
    const assigned = await as(transit, () =>
      assignTransitStep(fileId, "customs_preparation", transit.id),
    );
    expect(assigned.ok, `assign: ${JSON.stringify(assigned)}`).toBe(true);
    expect((await execution(fileId, "customs_preparation"))?.assigned_user_id).toBe(transit.id);

    await runStep(transit, "transit_declarant_assignment");
    expect((await execution(fileId, "transit_declarant_assignment"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("AVAILABLE");
  });

  // -------------------------------------------------- 6. customs preparation ----

  it("step 6 refuses to close before the customs dossier exists", async () => {
    const started = await as(transit, () => activateStep(fileId, "customs_preparation"));
    expect(started.ok, `activate step 6: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(transit, () => submitStep(fileId, "customs_preparation"));
    expect(premature.ok, "step 6 must refuse without CUSTOMS_DOSSIER").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("ACTIVE");
  });

  it("step 6 SUBMITS for review rather than completing — it is a maker step", async () => {
    // CUSTOMS_DOSSIER is not an upload: it is satisfied by the existence of the
    // structured customs record, created through the action that owns it.
    const created = await as(transit, () => createCustoms(fileId));
    expect(created.ok, `createCustoms: ${JSON.stringify(created)}`).toBe(true);

    // The customs STATUS ladder is walked here, not later, because the control
    // gate says so: `customs.status` is owned by customs_preparation, so once
    // step 6 closes the record can no longer be moved. Release is legal only
    // from INSPECTION or DUTIES_ASSESSED, so the declaration must reach one of
    // them during preparation for step 13 to be reachable at all.
    const customsId = await customsIdFor(fileId);
    for (const status of ["DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED", "DUTIES_ASSESSED"]) {
      const moved = await as(transit, () => changeCustomsStatus(customsId, status));
      expect(moved.ok, `customs -> ${status}: ${JSON.stringify(moved)}`).toBe(true);
    }

    const submitted = await as(transit, () => submitStep(fileId, "customs_preparation"));
    expect(submitted.ok, `submit step 6: ${JSON.stringify(submitted)}`).toBe(true);

    const exec = await execution(fileId, "customs_preparation");
    expect(exec?.state, "a reviewed step stops at SUBMITTED, never COMPLETED").toBe("SUBMITTED");
    expect(exec?.submitted_by).toBe(transit.id);
    expect(exec?.completed_at, "nothing is complete until it is reviewed").toBeNull();
  });

  // ---------------------------------------------- 7. INDEPENDENT VALIDATION ----

  it("6→7 MAKER ≠ CHECKER — the preparer cannot validate its own work", async () => {
    const before = await execution(fileId, "customs_preparation");

    const refused = await as(transit, () => approveStep(fileId, "transit_validation"));
    expect(refused.ok, "the preparer must not approve itself").toBe(false);
    expect((refused as { error: string }).error).toBe("self_validation_forbidden");

    // Nothing moved: not the preparer step, not the validator step.
    const after = await execution(fileId, "customs_preparation");
    expect(after?.state, "state must be unchanged after refusal").toBe("SUBMITTED");
    expect(after?.completed_at).toBeNull();
    expect(after?.reviewed_by, "a refused review may record no reviewer").toBeNull();
    expect(after?.submitted_by).toBe(before?.submitted_by);
    expect((await execution(fileId, "transit_validation"))?.state).not.toBe("COMPLETED");
  });

  it("…and an actor without customs:validate is refused for a DIFFERENT reason", async () => {
    // The two refusals must stay distinguishable: the declarant is not the
    // maker here, it simply may not review at all.
    const refused = await as(declarant, () => approveStep(fileId, "transit_validation"));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("forbidden");
    expect((await execution(fileId, "customs_preparation"))?.state).toBe("SUBMITTED");
  });

  it("step 7 — an INDEPENDENT holder of customs:validate completes both steps", async () => {
    const approved = await as(ops, () => approveStep(fileId, "transit_validation"));
    expect(approved.ok, `approve: ${JSON.stringify(approved)}`).toBe(true);

    const prep = await execution(fileId, "customs_preparation");
    expect(prep?.state).toBe("COMPLETED");
    expect(prep?.reviewed_by, "the reviewer is recorded").toBe(ops.id);
    expect(prep?.reviewed_by, "and is NOT the maker").not.toBe(prep?.submitted_by);

    expect((await execution(fileId, "transit_validation"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "coordinator_to_finance"))?.state).toBe("AVAILABLE");

    const events = await auditFor("process.step.approved", prep!.id as string);
    expect(events.length, "the approval must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id).toBe(ops.id);
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

  it("step 9 — Finance's registration IS the step; reconciliation closes it", async () => {
    const customsId = await customsIdFor(fileId);
    const registered = await as(customsFinance, () =>
      recordGaindeRegistration(customsId, `GAINDE-JRN-${Date.now()}`),
    );
    expect(registered.ok, `GAINDE registration: ${JSON.stringify(registered)}`).toBe(true);

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

  it("step 10 — Coordination hands it back to the declarant", async () => {
    await runStep(coordinator, "coordinator_to_declarant");
    expect((await execution(fileId, "coordinator_to_declarant"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "gainde_document_submission"))?.state).toBe("AVAILABLE");

    await handOver(coordinator, declarant, "coordinator_to_declarant", "gainde_document_submission");
  });

  it("step 11 — the declarant cannot close without GAINDE submission evidence", async () => {
    const started = await as(declarant, () => activateStep(fileId, "gainde_document_submission"));
    expect(started.ok, `activate step 11: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(declarant, () => submitStep(fileId, "gainde_document_submission"));
    expect(premature.ok).toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    // Real verified evidence — uploaded by the declarant, verified by another.
    await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", declarant, transit);

    const done = await as(declarant, () => submitStep(fileId, "gainde_document_submission"));
    expect(done.ok, `submit step 11: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "gainde_document_submission"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "customs_followup"))?.state).toBe("AVAILABLE");
  });

  it("step 12 — Coordination follows the declaration up", async () => {
    await runStep(coordinator, "customs_followup");
    expect((await execution(fileId, "customs_followup"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "customs_field_clearance"))?.state).toBe("AVAILABLE");
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

    // The release IS the fact that proves this step, so reconciliation closes it
    // — and now promotes from it.
    const s13 = await execution(fileId, "customs_field_clearance");
    expect(s13?.state).toBe("COMPLETED");
    expect(s13?.completion_provenance).toBe("RECONCILED");
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

    const opened = await as(ops, () =>
      openDossierWorkflow(reconFile, { ownerUserId: ops.id, skipCotation: true }),
    );
    if (!opened.ok) throw new Error(`recon workflow open failed: ${JSON.stringify(opened)}`);

    const s2 = await as(ops, () => submitStep(reconFile, "operations_intake"));
    if (!s2.ok) throw new Error(`recon step 2 failed: ${JSON.stringify(s2)}`);
    const started = await as(am, () => activateStep(reconFile, "am_dossier_opening"));
    if (!started.ok) throw new Error(`recon step 3 activate failed: ${JSON.stringify(started)}`);
  });

  it("with evidence outstanding, reconciliation leaves the step alone", async () => {
    await provideEvidence(reconFile, "BORDEREAU_LIVRAISON", am, ops);

    const exec = await execution(reconFile, "am_dossier_opening");
    expect(exec?.state).toBe("ACTIVE");
    expect(exec?.completion_provenance, "nothing was reconciled").toBeNull();
    // …and nothing downstream was opened on the strength of it.
    expect((await execution(reconFile, "transport_assignment"))?.state).toBe("PENDING");
  });

  it("with evidence satisfied, reconciliation COMPLETES the step and promotes", async () => {
    // Complete the evidence WITHOUT completing the step: declarations are not
    // uploads and trigger no reconciliation, so the step stays open and
    // genuinely satisfied at the same time.
    await provideEvidence(reconFile, "TRANSPORT_REQUEST", am, ops);
    for (const key of ["VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]) {
      const d = await as(am, () =>
        declareEvidenceAbsence(reconFile, key, `sans objet — ${key}`),
      );
      expect(d.ok, `declare ${key}: ${JSON.stringify(d)}`).toBe(true);
    }
    expect((await execution(reconFile, "am_dossier_opening"))?.state).toBe("ACTIVE");

    // Now trigger reconciliation with an ordinary verification. A second
    // version of an already-satisfied type changes no evidence verdict; it only
    // causes the reconciliation pass to run.
    await provideEvidence(reconFile, "TRANSPORT_REQUEST", am, ops);

    const exec = await execution(reconFile, "am_dossier_opening");
    expect(exec?.state, "satisfied evidence lets reconciliation close it").toBe("COMPLETED");
    expect(exec?.completion_provenance, "and it says so honestly").toBe("RECONCILED");
    expect(exec?.reconciled_fact, "naming the fact that proved it").toBeTruthy();

    // THE DEFECT: this used to stay PENDING forever, with no other path to
    // AVAILABLE, which made the whole transport-readiness branch unreachable.
    expect((await execution(reconFile, "transport_assignment"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "bon_a_delivrer"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "pre_gate"))?.state).toBe("AVAILABLE");
    expect((await execution(reconFile, "coordinator_reception"))?.state).toBe("AVAILABLE");
  });

  it("the reconciled promotion is audited and attributed to the causing actor", async () => {
    const exec = await execution(reconFile, "transport_assignment");
    const events = await auditFor("process.step.activated", exec!.id as string);
    expect(events.length, "a promotion is never unaudited").toBeGreaterThan(0);
    // ops verified the document that caused reconciliation, so ops is the
    // principal — the same rule as F-α on the action path.
    expect(events[0].actor_id).toBe(ops.id);

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
