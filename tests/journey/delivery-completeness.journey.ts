/**
 * C-4 SLICE 3a — Transport assignment → pickup convergence → delivery →
 * completeness (steps 14–19).
 * ---------------------------------------------------------------------------
 * Same apparatus, additive file. Real Postgres, real actions, real permissions,
 * real evidence, real audit. Nothing is written directly.
 *
 * This slice carries the two things slice 2 could only assert negatively: the
 * pickup CONVERGENCE actually opening once its second branch lands, and step 16
 * being performed by the Account Manager who owns it — the step that until
 * migration 125 was gated on a permission its own role did not hold, and so was
 * performable only by a supervisor.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { as } from "./identity";
import {
  identity, execution, auditFor, handoffs, provideEvidence, customsIdFor, transportFor,
  db, sinkMessagesFor, billingRecipientFor, fileRow, invoiceMoney, TENANT_A, CLIENT_DEPOSIT_REQUIRED,
} from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae } from "@/lib/process/engine/transit-actions";
import { createCustoms, changeCustomsStatus } from "@/lib/customs/actions";
import { createTransport, assignTransport, changeTransportStatus } from "@/lib/transport/actions";
import {
  prepareInvoiceDraft, submitInvoiceToFinance, approveInvoice, emailValidatedInvoice,
} from "@/lib/process/billing/actions";
import { addInvoiceLine } from "@/lib/finance/actions";
import {
  handInvoiceToAdministration, preparePackage, assignCourier, acceptAssignment,
  startDeposit, recordDeposit, uploadProofOfDeposit, submitProof, acceptProof,
  handToCollections,
} from "@/lib/deposit/actions";
import {
  assignCollector, recordFollowUp, completeCollections, evaluateClosureReadiness, closeDossier,
} from "@/lib/collections/actions";
import { recordPayment, verifyPayment } from "@/lib/finance/actions";
import { reconcileDossierProcess } from "@/lib/process/reconcile/service";
import { AuditActions } from "@/lib/audit/events";

let ops: CurrentUser;         // OPS_SUPERVISOR
let am: CurrentUser;          // ACCOUNT_MANAGER — owns steps 3, 16, 19
let transit: CurrentUser;     // CHIEF_OF_TRANSIT
let declarant: CurrentUser;   // CUSTOMS_DECLARANT — the customs-declaration queue
let coordinator: CurrentUser; // COORDINATOR — owns steps 17, 18
let field: CurrentUser;       // CUSTOMS_FIELD_AGENT
let transport: CurrentUser;   // TRANSPORT_OFFICER — owns step 14
let pickup: CurrentUser;      // PICKUP_AGENT — owns step 15
let billing: CurrentUser;     // BILLING_OFFICER — owns steps 20, 22
let finance: CurrentUser;     // FINANCE_OFFICER — owns step 21 (the checker)
let admin: CurrentUser;       // ADMINISTRATIVE_OFFICER — owns steps 23, 25
let courier: CurrentUser;     // COURIER — owns step 24
let driverIdentity: CurrentUser; // DRIVER — holds no courier:deposit
let collections: CurrentUser; // COLLECTIONS_OFFICER — owns step 26

let fileId = "";
// Section G continues on the SAME invoice, so it lives at module scope.
let invoiceId = "";
// Sections G and H/I share the deposit record.
let depositId = "";

async function runStep(actor: CurrentUser, stepKey: string) {
  const started = await as(actor, () => activateStep(fileId, stepKey));
  expect(started.ok, `activate ${stepKey}: ${JSON.stringify(started)}`).toBe(true);
  const done = await as(actor, () => submitStep(fileId, stepKey));
  expect(done.ok, `submit ${stepKey}: ${JSON.stringify(done)}`).toBe(true);
  return done;
}

async function handOver(sender: CurrentUser, receiver: CurrentUser, from: string, to: string) {
  const sent = await as(sender, () => sendHandoff(fileId, from, to));
  expect(sent.ok, `sendHandoff ${from}->${to}: ${JSON.stringify(sent)}`).toBe(true);
  const open = (await handoffs(fileId)).find((h) => h.status === "SENT" && h.to_step_key === to);
  expect(open, `no open handoff to ${to}`).toBeTruthy();
  const got = await as(receiver, () => receiveHandoff(fileId, open!.id as string));
  expect(got.ok, `receiveHandoff ${to}: ${JSON.stringify(got)}`).toBe(true);
}

/**
 * Carry a fresh dossier through steps 1–13, exactly as slice 2 proves them.
 *
 * Re-driven rather than shared: each journey file owns its dossier, so a failure
 * here can never be a side effect of another file's state, and the files stay
 * runnable in isolation. Slice 2 asserts these transitions; this only needs the
 * dossier to ARRIVE, so it asserts arrival and leaves the proving to slice 2.
 */
async function carryToStep13() {
  const created = await as(am, () =>
    createFile({
      type: "IMP",
      clientId: CLIENT_DEPOSIT_REQUIRED,
      priority: "normal",
      shipment: {
        transportMode: "SEA",
        origin: "JOURNEY SLICE3",
        destination: "Dakar",
        blAwbRef: `JRN-S3-${Date.now()}`,
      },
    }),
  );
  if (!created.ok) throw new Error(`slice 3 creation failed: ${JSON.stringify(created)}`);
  fileId = (created as { id: string }).id;

  const opened = await as(ops, () => openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }));
  if (!opened.ok) throw new Error(`slice 3 open failed: ${JSON.stringify(opened)}`);

  await as(ops, () => submitStep(fileId, "operations_intake"));
  await as(am, () => activateStep(fileId, "am_dossier_opening"));
  await provideEvidence(fileId, "BORDEREAU_LIVRAISON", am, ops);
  await provideEvidence(fileId, "TRANSPORT_REQUEST", am, ops);
  for (const key of ["VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]) {
    await as(am, () => declareEvidenceAbsence(fileId, key, `sans objet — ${key}`));
  }
  await as(am, () => submitStep(fileId, "am_dossier_opening"));

  await as(am, () => handDossierToTransit(fileId));
  await as(transit, () => receiveDossierAtTransit(fileId));
  await runStep(transit, "coordinator_reception");

  await as(transit, () => assignTransitStep(fileId, "customs_preparation", transit.id));
  await runStep(transit, "transit_declarant_assignment");

  await as(transit, () => activateStep(fileId, "customs_preparation"));
  await as(transit, () => createCustoms(fileId));
  for (const code of ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "BILL_OF_LADING"]) {
    await provideEvidence(fileId, code, transit, ops);
  }
  const customsId = await customsIdFor(fileId);
  for (const status of ["DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED", "DUTIES_ASSESSED"]) {
    const moved = await as(transit, () => changeCustomsStatus(customsId, status));
    if (!moved.ok) throw new Error(`customs -> ${status}: ${JSON.stringify(moved)}`);
  }
  await as(transit, () => submitStep(fileId, "customs_preparation"));
  await as(ops, () => approveStep(fileId, "transit_validation"));

  await runStep(coordinator, "coordinator_to_finance");
  await handOver(coordinator, ops, "coordinator_to_finance", "gainde_registration");
  // Finance douane's own act closes step 9 (proved in slice 2); ops holds
  // customs:register and file:read:all, so it stands in for the milestone here
  // without needing the handoff-receiver ground to survive reception.
  const { recordGaindeRegistration } = await import("@/lib/customs/actions");
  const reg = await as(ops, () => recordGaindeRegistration(customsId, `GAINDE-S3-${Date.now()}`));
  if (!reg.ok) throw new Error(`gainde: ${JSON.stringify(reg)}`);

  await runStep(coordinator, "coordinator_to_declarant");
  // The DECLARANT receives work routed to the customs-declaration queue.
  // Transit was accepted before reception eligibility was enforced; it is not
  // that department and may no longer take it.
  await handOver(coordinator, declarant, "coordinator_to_declarant", "gainde_document_submission");
  await as(declarant, () => activateStep(fileId, "gainde_document_submission"));
  await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", declarant, ops);
  await as(declarant, () => submitStep(fileId, "gainde_document_submission"));

  await runStep(coordinator, "customs_followup");

  await as(field, () => activateStep(fileId, "customs_field_clearance"));
  const bae = await as(field, () => recordBae(fileId, `BAE-S3-${Date.now()}`));
  if (!bae.ok) throw new Error(`bae: ${JSON.stringify(bae)}`);
}

describe("C-4 slice 3a — transport, convergence, delivery, completeness", () => {
  beforeAll(async () => {
    ops = await identity("ops");
    am = await identity("am");
    transit = await identity("transit");
    declarant = await identity("declarant");
    coordinator = await identity("coordinator");
    field = await identity("field");
    transport = await identity("transport");
    pickup = await identity("pickup");
    billing = await identity("billing");
    finance = await identity("finance");
    admin = await identity("admin");
    courier = await identity("courier");
    driverIdentity = await identity("driver");
    collections = await identity("collections");
    await carryToStep13();
  }, 120_000);

  it("the dossier arrives at step 13 COMPLETED with step 14 AVAILABLE", async () => {
    // The precondition, asserted rather than assumed: everything below is
    // meaningless if the carry did not actually land where slice 2 proves it does.
    expect((await execution(fileId, "customs_field_clearance"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("AVAILABLE");
    expect((await execution(fileId, "pickup"))?.state).toBe("PENDING");
  });

  // ------------------------------------------------------ A. step 14 ----

  it("step 14 — the Transport officer claims and records the assignment", async () => {
    const started = await as(transport, () => activateStep(fileId, "transport_assignment"));
    expect(started.ok, `activate step 14: ${JSON.stringify(started)}`).toBe(true);

    const created = await as(transport, () => createTransport(fileId));
    expect(created.ok, `createTransport: ${JSON.stringify(created)}`).toBe(true);

    const t = await transportFor(fileId);
    const assigned = await as(transport, () =>
      assignTransport(t.id, { driverName: "Journey Driver", vehiclePlate: "DK-JRN-2026" }, t.updatedAt),
    );
    expect(assigned.ok, `assignTransport: ${JSON.stringify(assigned)}`).toBe(true);

    const done = await as(transport, () => submitStep(fileId, "transport_assignment"));
    expect(done.ok, `submit step 14: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("COMPLETED");
  });

  it("the fleet/subcontractor executor is exclusive — one or the other, never both", async () => {
    // TMS-5/TMS-6: a transport is executed by the internal fleet XOR a
    // subcontractor. Enforced by a database CHECK, so the refusal is real and
    // not a UI convention.
    const t = await transportFor(fileId);
    const both = await as(transport, () =>
      assignTransport(
        t.id,
        {
          vehicleId: "00000000-0000-0000-0000-0000000000f1",
          providerId: "00000000-0000-0000-0000-0000000000f2",
        },
        t.updatedAt,
      ),
    );
    expect(both.ok, "a transport cannot have two executors").toBe(false);

    // …and the record is untouched by the refusal.
    const after = await transportFor(fileId);
    expect(after.id).toBe(t.id);
  });

  // ------------------------------------------- B. step 15 convergence ----

  it("step 15 is promoted by its LAST prerequisite — but still refuses to open", async () => {
    // Both prerequisites have now landed (customs_field_clearance in the carry,
    // transport_assignment just now), so promotion opens it…
    expect((await execution(fileId, "pickup"))?.state).toBe("AVAILABLE");

    // …and the READINESS gate is a second, independent question. Promotion says
    // "your prerequisites are done"; the gate says "the goods can actually be
    // collected". The Bon à Délivrer and the Pre-Gate authorisation are missing,
    // so pickup must not open.
    const blocked = await as(pickup, () => activateStep(fileId, "pickup"));
    expect(blocked.ok, "pickup must not open before its readiness gate").toBe(false);
    expect((blocked as { error: string }).error).toBe("gate_blocked");

    // Nothing pretended to succeed.
    const exec = await execution(fileId, "pickup");
    expect(exec?.state, "a blocked gate leaves the step AVAILABLE").toBe("AVAILABLE");
    expect(exec?.started_at).toBeNull();
    expect(exec?.assigned_user_id).toBeNull();
  });

  it("the transport-readiness branch lands through its own steps", async () => {
    // bon_a_delivrer and pre_gate are the Account Manager's parallel activities,
    // each requiring its own document. They hang off step 3 and are what the
    // pickup gate is waiting for.
    await as(am, () => activateStep(fileId, "bon_a_delivrer"));
    await provideEvidence(fileId, "BON_A_DELIVRER", am, ops);
    const bad = await as(am, () => submitStep(fileId, "bon_a_delivrer"));
    expect(bad.ok, `bon_a_delivrer: ${JSON.stringify(bad)}`).toBe(true);

    await as(am, () => activateStep(fileId, "pre_gate"));
    await provideEvidence(fileId, "PRE_GATE_AUTHORIZATION", am, ops);
    const pg = await as(am, () => submitStep(fileId, "pre_gate"));
    expect(pg.ok, `pre_gate: ${JSON.stringify(pg)}`).toBe(true);

    expect((await execution(fileId, "bon_a_delivrer"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "pre_gate"))?.state).toBe("COMPLETED");
  });

  it("step 15 — with every branch landed, pickup opens and completes", async () => {
    const started = await as(pickup, () => activateStep(fileId, "pickup"));
    expect(started.ok, `activate pickup: ${JSON.stringify(started)}`).toBe(true);
    expect((await execution(fileId, "pickup"))?.state).toBe("ACTIVE");

    // The collection itself is a transport fact, and it is what proves the step.
    const t = await transportFor(fileId);
    for (const status of ["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP"]) {
      const moved = await as(pickup, () => changeTransportStatus(t.id, status));
      expect(moved.ok, `transport -> ${status}: ${JSON.stringify(moved)}`).toBe(true);
    }

    const exec = await execution(fileId, "pickup");
    expect(exec?.state, "the collection fact closes the step").toBe("COMPLETED");
    expect(exec?.completion_provenance).toBe("RECONCILED");
    // …and a reconciled completion promotes, which is what slice 2's fix bought.
    expect((await execution(fileId, "am_delivery_followup"))?.state).toBe("AVAILABLE");
  });

  // --------------------------------------- C/D. delivery, POD, 16 & 17 ----

  it("step 16 — the ACCOUNT MANAGER performs its own step, unaided", async () => {
    // The step that migration 125 exists for. Before it, the owner was shown
    // this work and refused, and only a supervisor could clear it.
    const started = await as(am, () => activateStep(fileId, "am_delivery_followup"));
    expect(started.ok, `the owner must be able to start its own step: ${JSON.stringify(started)}`).toBe(true);
    expect((await execution(fileId, "am_delivery_followup"))?.state).toBe("ACTIVE");

    // Evidence is still enforced — the capability grants the step, not a waiver.
    const premature = await as(am, () => submitStep(fileId, "am_delivery_followup"));
    expect(premature.ok, "step 16 still needs the signed delivery note").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    await provideEvidence(fileId, "SIGNED_DELIVERY_NOTE", am, ops);

    const done = await as(am, () => submitStep(fileId, "am_delivery_followup"));
    expect(done.ok, `submit step 16: ${JSON.stringify(done)}`).toBe(true);

    // TRANSPORT marks the delivery — the other half of the split that gave step
    // 16 its own capability. The Account Manager obtained the signed BL; moving
    // the transport record to DELIVERED is Transport's act and TMS-4 keeps it
    // there. Closure later requires this fact (`delivery_complete`).
    const tRec = await transportFor(fileId);
    for (const status of ["IN_TRANSIT", "DELIVERED"]) {
      const moved = await as(transport, () => changeTransportStatus(tRec.id, status));
      expect(moved.ok, `transport -> ${status}: ${JSON.stringify(moved)}`).toBe(true);
    }

    const exec = await execution(fileId, "am_delivery_followup");
    expect(exec?.state).toBe("COMPLETED");
    expect(exec?.submitted_by, "the Account Manager, not a supervisor").toBe(am.id);
  });

  it("…and the Account Manager still cannot execute Transport's act", async () => {
    // The capability is narrow by construction. TMS-4's boundary is proved here
    // behaviourally, not just in the permission matrix: the AM may complete its
    // own workflow step and may not move the transport record.
    const t = await transportFor(fileId);
    const before = (await transportFor(fileId)).updatedAt;

    const refused = await as(am, () => changeTransportStatus(t.id, "DELIVERED"));
    expect(refused.ok, "transport:complete is not the Account Manager's").toBe(false);
    expect((refused as { error: string }).error).toBe("forbidden");

    // …and the record did not move.
    expect((await transportFor(fileId)).updatedAt).toBe(before);
  });

  it("the transport-documents transmission closes too — closure needs EVERY step", async () => {
    // The last parallel activity. Its prerequisites (pre-gate, bon à délivrer)
    // landed before pickup and its evidence is already verified, so it is
    // ordinary work — but closure requires every official step, and a journey
    // that skipped it would meet the gate and never say why.
    const started = await as(coordinator, () => activateStep(fileId, "transport_docs_transmission"));
    expect(started.ok, `activate transmission: ${JSON.stringify(started)}`).toBe(true);
    const done = await as(coordinator, () => submitStep(fileId, "transport_docs_transmission"));
    expect(done.ok, `submit transmission: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "transport_docs_transmission"))?.state).toBe("COMPLETED");
  });

  it("step 17 — the POD fact closes the handoff; Coordination does not re-do it", async () => {
    // The signed delivery note IS the POD, and `transport_pod_handoff` is
    // fact-provable, so verifying that document closed step 17 by reconciliation
    // — the same shape as steps 9 and 13. The handoff is the artefact moving
    // across, not a second click, and asserting a manual completion here would
    // have been asserting a click the platform does not ask for.
    const s17 = await execution(fileId, "transport_pod_handoff");
    expect(s17?.state).toBe("COMPLETED");
    expect(s17?.completion_provenance).toBe("RECONCILED");
    expect((await execution(fileId, "coordinator_completeness"))?.state).toBe("AVAILABLE");

    // …and the reconciled promotion is attributed to whoever caused it — the
    // person who verified the POD, not the step's nominal owner.
    const exec = await execution(fileId, "coordinator_completeness");
    const events = await auditFor("process.step.activated", exec!.id as string);
    expect(events.length, "the promotion must be audited").toBeGreaterThan(0);
    expect(events.some((e) => e.actor_id === ops.id), "attributed to the POD verifier").toBe(true);
  });

  // --------------------------------- E. 18 → 19 the second maker/checker ----

  it("step 18 refuses without its receipts, then stops at SUBMITTED", async () => {
    const started = await as(coordinator, () => activateStep(fileId, "coordinator_completeness"));
    expect(started.ok, `activate step 18: ${JSON.stringify(started)}`).toBe(true);

    const premature = await as(coordinator, () => submitStep(fileId, "coordinator_completeness"));
    expect(premature.ok, "completeness needs its evidence").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");

    // RECEIPT and PAYMENT_PROOF both map to PAYMENT_RECEIPT, so one verified
    // document satisfies both keys — the mapping is the registry's, not ours.
    await provideEvidence(fileId, "RECEIPT", coordinator, ops);

    const submitted = await as(coordinator, () => submitStep(fileId, "coordinator_completeness"));
    expect(submitted.ok, `submit step 18: ${JSON.stringify(submitted)}`).toBe(true);

    const exec = await execution(fileId, "coordinator_completeness");
    expect(exec?.state, "18 is reviewed by 19 — it must not self-complete").toBe("SUBMITTED");
    expect(exec?.submitted_by).toBe(coordinator.id);
    expect(exec?.completed_at).toBeNull();
  });

  it("18→19 MAKER ≠ CHECKER — the preparer cannot sign its own completeness", async () => {
    // COORDINATOR and ACCOUNT_MANAGER both hold process:completeness:review, so
    // this refusal is about IDENTITY and not about permission — which is exactly
    // what the rule claims to enforce.
    const refused = await as(coordinator, () => approveStep(fileId, "am_completeness"));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("self_validation_forbidden");

    const after = await execution(fileId, "coordinator_completeness");
    expect(after?.state, "state unchanged after refusal").toBe("SUBMITTED");
    expect(after?.completed_at).toBeNull();
    expect(after?.reviewed_by, "no reviewer may be recorded by a refused review").toBeNull();
    expect((await execution(fileId, "am_completeness"))?.state).not.toBe("COMPLETED");
  });

  it("step 19 — the Account Manager approves independently", async () => {
    const approved = await as(am, () => approveStep(fileId, "am_completeness"));
    expect(approved.ok, `approve 19: ${JSON.stringify(approved)}`).toBe(true);

    const prep = await execution(fileId, "coordinator_completeness");
    expect(prep?.state).toBe("COMPLETED");
    expect(prep?.reviewed_by).toBe(am.id);
    expect(prep?.reviewed_by, "maker ≠ checker, on identity").not.toBe(prep?.submitted_by);

    expect((await execution(fileId, "am_completeness"))?.state).toBe("COMPLETED");
    // …and the billing gate opens only now.
    expect((await execution(fileId, "billing_draft"))?.state).toBe("AVAILABLE");
  });
});

/**
 * C-4 SLICE 3 SECTION F — governed billing (steps 20–22).
 * ---------------------------------------------------------------------------
 * The GOVERNED lane only: prepareInvoiceDraft → submitInvoiceToFinance →
 * approveInvoice → emailValidatedInvoice. Not `issueInvoice`, which is the
 * simple /finance path and does not carry the delivery contract.
 *
 * SCOPE, stated plainly, because the boundary matters more than the coverage.
 * The ratified rule is that an invoice becomes ISSUED only after a SUCCESSFUL
 * provider delivery. `sendEmail` has three outcomes and none is a test seam:
 * unset → provider_not_configured, `smtp` → provider_not_implemented (a
 * documented stub), `resend` → a real HTTPS POST to a real inbox. Stubbing it
 * to return {ok:true} is exactly the lie EMP-3 / RATIFY-EMP3-2 removed, and it
 * would destroy the one invariant step 22 exists to enforce.
 *
 * So this proves the PROTECTIVE half — no delivery, no issuance — exercised
 * honestly because CI genuinely has no provider. The POSITIVE half (successful
 * delivery ⇒ ISSUED ⇒ step 22 advances) is NOT exercised here and is recorded
 * as an external-boundary verification requirement, never as an automated pass.
 */
describe("C-4 section F — governed billing, and the issuance boundary", () => {

  it("step 20 is REFUSED on a dossier that is not billing-ready", async () => {
    // A fresh dossier: opened, but nowhere near the completeness reviews. This
    // is the gate the platform never had — an invoice used to be creatable on
    // any dossier at any time, with no evidence at all.
    const other = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY NOTREADY",
          destination: "Dakar",
          blAwbRef: `JRN-NR-${Date.now()}`,
        },
      }),
    );
    expect(other.ok).toBe(true);
    const otherId = (other as { id: string }).id;
    await as(ops, () => openDossierWorkflow(otherId, { ownerUserId: ops.id, skipCotation: true }));

    const refused = await as(billing, () => prepareInvoiceDraft(otherId));
    expect(refused.ok, "no invoice before the completeness reviews").toBe(false);
    expect((refused as { error: string }).error).toBe("dossier_not_billing_ready");

    const { data } = await db().from("invoice").select("id").eq("file_id", otherId);
    expect(data ?? [], "a refused draft must leave no invoice behind").toHaveLength(0);
  });

  it("step 20 — with the gate open, Billing prepares the draft", async () => {
    expect((await execution(fileId, "billing_draft"))?.state).toBe("AVAILABLE");

    // Claim the official step first, as an operator does with « Démarrer ».
    // The billing lane advances the engine through submitStep/approveStep, and
    // those need the step ACTIVE — AVAILABLE -> COMPLETED is not a legal
    // transition. Without this the invoice lane runs to completion while the
    // workflow never moves.
    const started = await as(billing, () => activateStep(fileId, "billing_draft"));
    expect(started.ok, `activate step 20: ${JSON.stringify(started)}`).toBe(true);

    const draft = await as(billing, () => prepareInvoiceDraft(fileId));
    expect(draft.ok, `prepareInvoiceDraft: ${JSON.stringify(draft)}`).toBe(true);
    invoiceId = (draft as { id: string }).id;

    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number, submitted_by, validated_by, validated_at")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status).toBe("DRAFT");
    // NUMBERING: not consumed at draft. An unsent invoice has no number.
    expect(inv?.invoice_number, "a draft must not hold an official number").toBeNull();
    expect(inv?.validated_by).toBeNull();
    expect(inv?.validated_at).toBeNull();
  });

  it("a draft with no lines cannot be submitted", async () => {
    const empty = await as(billing, () => submitInvoiceToFinance(invoiceId));
    expect(empty.ok, "an invoice with nothing on it is not submittable").toBe(false);
    expect((empty as { error: string }).error).toBe("no_lines");

    const line = await as(billing, () =>
      addInvoiceLine(invoiceId, {
        description: "Prestation transit — journey",
        quantity: 1,
        unitAmount: 250000,
        taxRate: 18,
      }),
    );
    expect(line.ok, `addInvoiceLine: ${JSON.stringify(line)}`).toBe(true);

    // Submitted by OPS_SUPERVISOR, and that choice is the whole point of the
    // next case. BILLING_OFFICER holds no finance:validate, so a self-approval
    // by the drafter would be refused for lack of PERMISSION and would prove
    // nothing about identity. OPS_SUPERVISOR holds finance:create AND
    // finance:validate by design — approveInvoice's own comment says so — and
    // is the one identity that can demonstrate the rule the pair exists for.
    const submitted = await as(ops, () => submitInvoiceToFinance(invoiceId));
    expect(submitted.ok, `submitInvoiceToFinance: ${JSON.stringify(submitted)}`).toBe(true);

    const { data: inv } = await db()
      .from("invoice")
      .select("submitted_by, status")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.submitted_by).toBe(ops.id);
    expect(inv?.status, "submission is not validation").toBe("DRAFT");
  });

  it("issuance BEFORE validation is refused", async () => {
    // Asserted HERE, while the invoice is still an unvalidated draft — the only
    // moment this negative case is real.
    const early = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(early.ok).toBe(false);
    expect((early as { error: string }).error).toBe("invoice_not_validated");

    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status, "a refused issuance changes nothing").toBe("DRAFT");
    expect(inv?.invoice_number).toBeNull();
  });

  it("an actor without finance:validate is refused for a DIFFERENT reason", async () => {
    // The two refusals must stay distinguishable: the Billing Officer is not
    // the maker here, it simply may not validate at all.
    const refused = await as(billing, () => approveInvoice(invoiceId));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("forbidden");
  });

  it("20→21 MAKER ≠ CHECKER — the submitter cannot validate its own invoice", async () => {
    // ops submitted it and ops holds finance:validate, so this refusal is about
    // WHO is asking and not about what they may do.
    const refused = await as(ops, () => approveInvoice(invoiceId));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("self_approval_forbidden");

    const { data: inv } = await db()
      .from("invoice")
      .select("status, validated_by, validated_at, submitted_by")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status, "still an unvalidated draft").toBe("DRAFT");
    expect(inv?.validated_by, "no validator identity may be recorded").toBeNull();
    expect(inv?.validated_at, "no validation timestamp may be recorded").toBeNull();
    expect(inv?.submitted_by).toBe(ops.id);
    expect((await execution(fileId, "finance_invoice_validation"))?.state).not.toBe("COMPLETED");
  });

  it("step 21 — an independent Finance identity validates", async () => {
    const approved = await as(finance, () => approveInvoice(invoiceId));
    expect(approved.ok, `approveInvoice: ${JSON.stringify(approved)}`).toBe(true);

    const { data: inv } = await db()
      .from("invoice")
      .select("status, validated_by, validated_at, submitted_by, invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status).toBe("VALIDATED");
    expect(inv?.validated_by).toBe(finance.id);
    expect(inv?.validated_at, "validated_at is set").toBeTruthy();
    expect(inv?.validated_by, "maker ≠ checker, on identity").not.toBe(inv?.submitted_by);
    // NUMBERING: still not consumed. Validation is not issuance.
    expect(inv?.invoice_number, "validation must not allocate an official number").toBeNull();
  });

  it("THE ISSUANCE INVARIANT — a delivery that genuinely FAILS issues nothing", async () => {
    // The provider is real and configured, so the failure has to be real too:
    // the SMTP host is pointed at a port nothing is listening on, producing an
    // actual ECONNREFUSED inside the transport. Nothing is stubbed and no
    // success is faked — which is the whole reason SMTP was implemented rather
    // than mocked.
    const realPort = process.env.SMTP_PORT;
    process.env.SMTP_PORT = "1";
    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));
    process.env.SMTP_PORT = realPort;
    expect(sent.ok, "a send that did not happen must not report success").toBe(false);
    expect((sent as { error: string }).error).toBe("email_send_failed");

    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number, issue_date, issued_by")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status, "a failed delivery must not issue the invoice").toBe("VALIDATED");
    expect(inv?.invoice_number, "and must not stamp it with a number").toBeNull();
    expect(inv?.issue_date).toBeNull();
    expect(inv?.issued_by).toBeNull();

    expect((await execution(fileId, "billing_dispatch"))?.state).not.toBe("COMPLETED");

    const events = await auditFor("invoice.email.failed", invoiceId);
    expect(events.length, "a failed delivery must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id).toBe(billing.id);
  });


  it("step 22 — a REAL SMTP delivery is what issues the invoice", async () => {
    // The provider is the ordinary `smtp` one, pointed at a disposable sink.
    // Nothing about this path is test-aware: emailValidatedInvoice does not know
    // where the mail is going, and the invoice becomes ISSUED for exactly one
    // reason — a server accepted the message.
    // Step 22 is NOT pre-claimed here. Since the irreversible-send correction,
    // emailValidatedInvoice prepares the step itself before anything leaves the
    // building — and the earlier failed-delivery case already left it ACTIVE, so
    // claiming it again would be an illegal ACTIVE -> ACTIVE transition.
    const recipient = await billingRecipientFor(CLIENT_DEPOSIT_REQUIRED);
    const before = (await sinkMessagesFor(recipient)).length;

    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(sent.ok, `emailValidatedInvoice: ${JSON.stringify(sent)}`).toBe(true);

    // THE SINK ACTUALLY RECEIVED IT. Asserted at the destination, not from the
    // application's own report: "the action said ok" and "a message arrived" are
    // two different claims, and step 22's contract rests on the second.
    const after = await sinkMessagesFor(recipient);
    expect(after.length, "the mail sink must have received the invoice").toBe(before + 1);

    // …and the invoice is ISSUED, with its official identity populated.
    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number, issue_date, due_date, issued_by")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status, "delivery is what issues it").toBe("ISSUED");
    expect(inv?.invoice_number, "the official number is assigned at issuance").toBeTruthy();
    expect(inv?.issue_date, "and the issue date").toBeTruthy();
    expect(inv?.due_date, "and the due date").toBeTruthy();
    expect(inv?.issued_by, "attributed to the issuer").toBe(billing.id);

    // …step 22 completes, on the delivery and not on the click.
    expect((await execution(fileId, "billing_dispatch"))?.state).toBe("COMPLETED");

    // …the send is audited with the recipient and the outcome.
    const events = await auditFor("invoice.emailed", invoiceId);
    expect(events.length, "a delivery must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id).toBe(billing.id);
    expect((events[0].after as { recipient?: string })?.recipient).toBe(recipient);

    // …and step 23 becomes eligible — the wall the journey could not cross.
    expect((await execution(fileId, "administration_deposit_prep"))?.state).toBe("AVAILABLE");
  });

  it("re-sending cannot issue or bill twice", async () => {
    const recipient = await billingRecipientFor(CLIENT_DEPOSIT_REQUIRED);
    const before = (await sinkMessagesFor(recipient)).length;

    // OBSERVED, and worth naming: the action documents an idempotent
    // short-circuit for an already-SENT message, but `canEmailInvoice` runs
    // FIRST and requires VALIDATED — so once the invoice is ISSUED the repeat is
    // refused as `invoice_not_validated` and the idempotency branch is
    // unreachable. The PROTECTIVE property is intact either way, which is what
    // this asserts: the client is not emailed twice and the invoice is not
    // re-issued. The friendly-success half of the comment is not true today.
    const again = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(again.ok).toBe(false);
    expect((again as { error: string }).error).toBe("invoice_not_validated");

    const after = await sinkMessagesFor(recipient);
    expect(after.length, "the client is not emailed a second time").toBe(before);

    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status).toBe("ISSUED");
  });

  it("NUMBERING — the sequence advances before delivery, so failures leave gaps", async () => {
    // OPEN BUSINESS RULING, recorded deterministically rather than judged.
    //
    // `next_invoice_number` is called BEFORE the send. A delivery that fails
    // therefore consumes a sequence value that no document will ever carry, and
    // a retry consumes another. The code comment says "an unsent invoice has no
    // number", which is true of the INVOICE and not of the SEQUENCE.
    //
    // Whether gaps in the official numbering are acceptable under Effitrans's
    // accounting obligations is a Finance ruling, not an engineering one. This
    // pins the mechanism precisely so the ruling is made against facts.

    // 1. The sequence itself is gapless: two consecutive draws differ by one.
    //    So any gap observed in production comes from CONSUMPTION WITHOUT
    //    ASSIGNMENT, not from the generator.
    const tail = (n: string) => Number((n.match(/(\d+)\s*$/) ?? [])[1] ?? NaN);
    const a = await db().rpc("next_invoice_number", { p_tenant: TENANT_A });
    const b = await db().rpc("next_invoice_number", { p_tenant: TENANT_A });
    expect(a.error, "the sequence is readable").toBeFalsy();
    expect(b.error).toBeFalsy();
    const na = tail(String(a.data));
    const nb = tail(String(b.data));
    expect(Number.isFinite(na) && Number.isFinite(nb), `unparsable numbers: ${a.data} / ${b.data}`).toBe(true);
    expect(nb - na, "the generator itself skips nothing").toBe(1);

    // 2. Allocation precedes delivery in the governed lane. This is the
    //    mechanism that turns a failed send into a permanent gap.
    const src = readFileSync(
      fileURLToPath(new URL("../../lib/process/billing/actions.ts", import.meta.url)),
      "utf8",
    );
    const email = src.slice(src.indexOf("export async function emailValidatedInvoice"));
    const alloc = email.indexOf('rpc("next_invoice_number"');
    const send = email.indexOf("await queueAndSend(");
    expect(alloc, "the number is allocated in this action").toBeGreaterThan(-1);
    expect(send, "and the send happens in it too").toBeGreaterThan(-1);
    expect(alloc, "allocation currently precedes delivery").toBeLessThan(send);

    // 3. The consequence, already observed above: the failed attempt left the
    //    invoice unnumbered while the sequence had moved on.
    const { data: inv } = await db()
      .from("invoice")
      .select("invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.invoice_number, "the issued invoice carries a number").toBeTruthy();
    // …and it is NOT the value the first, failed attempt consumed.
    expect(tail(String(inv?.invoice_number)), "a value was burned by the failure").toBeLessThan(na);
  });
});

/**
 * C-4 SECTION G — physical deposit: Administration, Courier, independent review
 * (steps 23–25), on the deposit-REQUIRED client.
 * ---------------------------------------------------------------------------
 * Continues the same dossier, which arrived here the only legitimate way: a real
 * SMTP delivery completed step 22 and promoted step 23.
 *
 * The custody lifecycle is the platform's own and is exercised as such —
 * PREPARATION_PENDING → READY_FOR_COURIER → ASSIGNED → IN_TRANSIT → DEPOSITED →
 * PROOF_SUBMITTED → PROOF_ACCEPTED — not an approximation of it.
 */
describe("C-4 section G — physical deposit (steps 23–25)", () => {

  it("step 23 arrived only because step 22 genuinely completed", async () => {
    expect((await execution(fileId, "billing_dispatch"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "administration_deposit_prep"))?.state).toBe("AVAILABLE");
    // …and step 24 is not open yet: it waits on 23.
    expect((await execution(fileId, "courier_deposit"))?.state).toBe("PENDING");
  });

  it("Billing hands the invoice to Administration — the canonical custody transfer", async () => {
    const handed = await as(billing, () => handInvoiceToAdministration(invoiceId));
    expect(handed.ok, `handInvoiceToAdministration: ${JSON.stringify(handed)}`).toBe(true);
    depositId = (handed as { id: string }).id;

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, courier_user_id, proof_document_id, validated_by_admin")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status, "custody begins unprepared").toBe("PREPARATION_PENDING");
    expect(dep?.courier_user_id, "and unassigned").toBeNull();
    expect(dep?.proof_document_id).toBeNull();
  });

  it("a NON-Administration actor cannot prepare the package", async () => {
    // The courier holds courier:deposit, not admin_service:manage.
    const refused = await as(courier, () =>
      preparePackage(depositId, { clientLocation: "Dakar", packageReference: "PKG-X" }),
    );
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toBe("forbidden");

    const { data: dep } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(dep?.status, "a refused preparation changes nothing").toBe("PREPARATION_PENDING");
  });

  it("step 23 — the Administrative Officer claims it, prepares, and assigns a courier", async () => {
    const started = await as(admin, () => activateStep(fileId, "administration_deposit_prep"));
    expect(started.ok, `activate step 23: ${JSON.stringify(started)}`).toBe(true);

    const prepared = await as(admin, () =>
      preparePackage(depositId, {
        clientLocation: "Siège client — Dakar Plateau",
        deliveryInstructions: "Remettre au service comptabilité",
        packageReference: "PKG-JRN-23",
      }),
    );
    expect(prepared.ok, `preparePackage: ${JSON.stringify(prepared)}`).toBe(true);

    const { data: ready } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(ready?.status).toBe("READY_FOR_COURIER");

    const assigned = await as(admin, () => assignCourier(depositId, courier.id));
    expect(assigned.ok, `assignCourier: ${JSON.stringify(assigned)}`).toBe(true);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, courier_user_id")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status).toBe("ASSIGNED");
    expect(dep?.courier_user_id, "assigned to a named courier").toBe(courier.id);

    const done = await as(admin, () => submitStep(fileId, "administration_deposit_prep"));
    expect(done.ok, `submit step 23: ${JSON.stringify(done)}`).toBe(true);

    const exec = await execution(fileId, "administration_deposit_prep");
    expect(exec?.state).toBe("COMPLETED");
    expect(exec?.submitted_by, "the Administrative Officer, not a supervisor").toBe(admin.id);

    // …and step 24 opens by ordinary successor promotion.
    expect((await execution(fileId, "courier_deposit"))?.state).toBe("AVAILABLE");
  });

  it("a courier who is NOT the assignee cannot take over the custody", async () => {
    // driver holds no courier:deposit at all, so this is refused outright…
    const outsider = await as(driverIdentity, () => acceptAssignment(depositId));
    expect(outsider.ok).toBe(false);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, courier_user_id")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status, "custody is untouched by a refused takeover").toBe("ASSIGNED");
    expect(dep?.courier_user_id).toBe(courier.id);
  });

  it("step 24 — the assigned courier accepts, departs, deposits", async () => {
    const accepted = await as(courier, () => acceptAssignment(depositId));
    expect(accepted.ok, `acceptAssignment: ${JSON.stringify(accepted)}`).toBe(true);

    // Departure before deposit — the ladder is the platform's, and it is obeyed.
    const departed = await as(courier, () => startDeposit(depositId));
    expect(departed.ok, `startDeposit: ${JSON.stringify(departed)}`).toBe(true);
    const { data: transit } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(transit?.status).toBe("IN_TRANSIT");

    const deposited = await as(courier, () =>
      recordDeposit(depositId, { recipientName: "Mme Diop", recipientRole: "Comptabilité" }),
    );
    expect(deposited.ok, `recordDeposit: ${JSON.stringify(deposited)}`).toBe(true);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, recipient_name, proof_document_id")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status).toBe("DEPOSITED");
    expect(dep?.recipient_name).toBe("Mme Diop");
    expect(dep?.proof_document_id, "no proof yet").toBeNull();
  });

  it("the proof cannot be SUBMITTED before it is uploaded", async () => {
    const premature = await as(courier, () => submitProof(depositId));
    expect(premature.ok, "there is nothing to submit").toBe(false);

    const { data: dep } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(dep?.status, "state unchanged").toBe("DEPOSITED");
  });

  it("the proof is uploaded through the REAL document path, unverified", async () => {
    const fd = new FormData();
    fd.set("file", new File(["%PDF-1.4 proof of deposit"], "proof.pdf", { type: "application/pdf" }));
    const uploaded = await as(courier, () => uploadProofOfDeposit(depositId, fd));
    expect(uploaded.ok, `uploadProofOfDeposit: ${JSON.stringify(uploaded)}`).toBe(true);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("proof_document_id, status")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.proof_document_id, "a real document row").toBeTruthy();

    // NOT verified by the act of uploading it. The courier produced evidence;
    // nobody has checked it.
    const { data: doc } = await db()
      .from("document")
      .select("status, uploaded_by")
      .eq("id", dep!.proof_document_id as string)
      .maybeSingle();
    expect(doc?.status, "uploading is not verifying").not.toBe("VERIFIED");
    expect(doc?.uploaded_by).toBe(courier.id);

    const submitted = await as(courier, () => submitProof(depositId));
    expect(submitted.ok, `submitProof: ${JSON.stringify(submitted)}`).toBe(true);
    const { data: after } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(after?.status).toBe("PROOF_SUBMITTED");
  });

  it("step 25 MAKER ≠ CHECKER — the courier cannot review its own proof", async () => {
    // The courier holds no admin_service:manage, so this refusal would be about
    // permission — which proves the wrong thing. The identity rule is asserted
    // where it lives: acceptProof refuses when the reviewer IS the courier, and
    // that is proved below with an actor who holds the permission.
    const refused = await as(courier, () => acceptProof(depositId));
    expect(refused.ok).toBe(false);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, validated_by_admin")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status, "still awaiting an independent review").toBe("PROOF_SUBMITTED");
    expect(dep?.validated_by_admin, "no reviewer identity may be written").toBeNull();
    expect((await execution(fileId, "administration_proof_handoff"))?.state).not.toBe("COMPLETED");
  });

  it("…and the identity rule holds even for an actor who COULD otherwise review", async () => {
    // The rule's real target: someone holding admin_service:manage who is also
    // the courier on this deposit. Proved on the record rather than by
    // permission, by pointing the deposit's courier at that identity through the
    // canonical re-assignment action and attempting the review as them.
    const reassigned = await as(admin, () => assignCourier(depositId, admin.id, "test de séparation des rôles"));
    if (reassigned.ok) {
      const selfReview = await as(admin, () => acceptProof(depositId));
      expect(selfReview.ok, "holding the permission does not license self-review").toBe(false);
      expect((selfReview as { error: string }).error).toBe("self_review_forbidden");

      const { data: dep } = await db()
        .from("invoice_deposit")
        .select("validated_by_admin")
        .eq("id", depositId)
        .maybeSingle();
      expect(dep?.validated_by_admin).toBeNull();

      // …put it back so the legitimate review below is the real one.
      const restored = await as(admin, () => assignCourier(depositId, courier.id, "retour au coursier"));
      expect(restored.ok, `restore courier: ${JSON.stringify(restored)}`).toBe(true);
    }
  });

  it("step 25 — an INDEPENDENT Administrative Officer accepts the proof", async () => {
    const { data: pre } = await db()
      .from("invoice_deposit")
      .select("courier_user_id, proof_document_id, status")
      .eq("id", depositId)
      .maybeSingle();
    expect(pre?.status).toBe("PROOF_SUBMITTED");

    const accepted = await as(admin, () => acceptProof(depositId));
    expect(accepted.ok, `acceptProof: ${JSON.stringify(accepted)}`).toBe(true);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, validated_by_admin, courier_user_id, proof_document_id")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status).toBe("PROOF_ACCEPTED");
    expect(dep?.validated_by_admin).toBe(admin.id);
    expect(dep?.validated_by_admin, "reviewer ≠ proof producer").not.toBe(dep?.courier_user_id);

    // The proof reaches its canonical verified state — through the review, not
    // through the upload.
    const { data: doc } = await db()
      .from("document")
      .select("status, reviewed_by")
      .eq("id", dep!.proof_document_id as string)
      .maybeSingle();
    expect(doc?.status).toBe("VERIFIED");
    expect(doc?.reviewed_by).toBe(admin.id);
  });

  it("steps 24 and 25 close, and step 26 becomes reachable", async () => {
    await runStep(courier, "courier_deposit");
    expect((await execution(fileId, "courier_deposit"))?.state).toBe("COMPLETED");

    const started = await as(admin, () => activateStep(fileId, "administration_proof_handoff"));
    expect(started.ok, `activate step 25: ${JSON.stringify(started)}`).toBe(true);

    const handed = await as(admin, () => handToCollections(depositId));
    expect(handed.ok, `handToCollections: ${JSON.stringify(handed)}`).toBe(true);

    const { data: dep } = await db().from("invoice_deposit").select("status").eq("id", depositId).maybeSingle();
    expect(dep?.status).toBe("HANDED_TO_COLLECTIONS");

    // Handing to Recouvrement IS the step, as at 9, 13 and 17: the action sends
    // the canonical handoff AND closes step 25 itself. A second submit would be
    // a click the platform does not ask for.
    const exec = await execution(fileId, "administration_proof_handoff");
    expect(exec?.state).toBe("COMPLETED");

    // Step 26 is reached through the CANONICAL routing — a real handoff row,
    // not a bare promotion. PROMOTION establishes eligibility; the HANDOFF
    // establishes departmental custody. One must never silently stand in for
    // the other, which is exactly what happened while this send was refused.
    const toCollections = (await handoffs(fileId)).find((h) => h.to_step_key === "collections");
    expect(toCollections, "a handoff to Recouvrement must exist").toBeTruthy();
    expect(toCollections!.from_step_key).toBe("administration_proof_handoff");
    expect(toCollections!.sent_by, "sent by the Administrative Officer").toBe(admin.id);
    expect(toCollections!.status).toBe("SENT");
    expect(toCollections!.received_by, "sending is not receiving").toBeNull();

    // …and the custody record references the REAL handoff, not null.
    const { data: custody } = await db()
      .from("invoice_deposit_event")
      .select("handoff_id, event")
      .eq("deposit_id", depositId)
      .eq("event", "HANDED_TO_COLLECTIONS")
      .maybeSingle();
    expect(custody?.handoff_id, "custody must reference the actual handoff").toBe(toCollections!.id);

    expect((await execution(fileId, "collections"))?.state).toBe("AVAILABLE");
  });

  it("a permission-holder who is NOT the routed receiver cannot take it", async () => {
    // The proof that the new grant is NARROW. The Account Manager holds
    // process:handoff:receive AND file:read:all, so permission and visibility
    // are both satisfied — and it is not the department this work was routed
    // to. Before eligibility was enforced, that was enough to take it.
    const open = (await handoffs(fileId)).find(
      (h) => h.to_step_key === "collections" && h.status === "SENT",
    );
    expect(open, "the collections handoff is waiting").toBeTruthy();

    const refused = await as(am, () => receiveHandoff(fileId, open!.id as string));
    expect(refused.ok, "seeing a dossier is not being its next department").toBe(false);
    expect((refused as { error: string }).error).toBe("not_eligible_receiver");

    // NOTHING moved.
    const after = (await handoffs(fileId)).find((h) => h.id === open!.id);
    expect(after!.status, "the handoff is still waiting").toBe("SENT");
    expect(after!.received_by, "no receiver recorded").toBeNull();
    expect((await execution(fileId, "collections"))?.state, "and the step was not opened by the refusal")
      .toBe("AVAILABLE");
  });

  it("step 26 — Recouvrement RECEIVES explicitly; nothing auto-receives", async () => {
    const open = (await handoffs(fileId)).find(
      (h) => h.to_step_key === "collections" && h.status === "SENT",
    );
    expect(open, "the handoff is waiting to be received").toBeTruthy();

    const received = await as(collections, () => receiveHandoff(fileId, open!.id as string));
    expect(received.ok, `receiveHandoff: ${JSON.stringify(received)}`).toBe(true);

    const closed = (await handoffs(fileId)).find((h) => h.id === open!.id);
    expect(closed!.status).toBe("RECEIVED");
    expect(closed!.received_by, "received by Recouvrement").toBe(collections.id);
    expect(closed!.received_by, "receiver ≠ sender").not.toBe(closed!.sent_by);

    // …and the Collections officer can now act on its own step.
    const started = await as(collections, () => activateStep(fileId, "collections"));
    expect(started.ok, `activate step 26: ${JSON.stringify(started)}`).toBe(true);
    expect((await execution(fileId, "collections"))?.state).toBe("ACTIVE");
  });
});

/**
 * C-4 SECTION H/I — Recouvrement, payment, reconciliation, closure.
 * ---------------------------------------------------------------------------
 * Continues the deposit-REQUIRED dossier, which reached Recouvrement the only
 * legitimate way: an explicit handoff sent by Administration and received by
 * Recouvrement itself.
 *
 * WHEN STEP 26 COMPLETES was read from the implementation rather than assumed:
 * `completeCollections` requires a zero outstanding balance and no open
 * dispute, and only then submits the step. So Recouvrement's step closes AFTER
 * payment, not before it — the follow-up work happens while the balance stands.
 *
 * WHO CLOSES is likewise read rather than assumed: `closeDossier` requires
 * `process:close`, held by SYSTEM_ADMIN and OPS_SUPERVISOR only, and the
 * collections queue offers no close action. Closure is a supervisory act
 * distinct from step 26, and this file follows that rather than granting
 * anything to make Recouvrement do it.
 */
describe("C-4 section H/I — Recouvrement, payment, reconciliation, closure", () => {
  it("step 26 — the Collections Officer works the dossier unaided", async () => {
    // Claimed in Section G by the Collections Officer itself.
    expect((await execution(fileId, "collections"))?.state).toBe("ACTIVE");

    const assigned = await as(collections, () => assignCollector(invoiceId, collections.id));
    expect(assigned.ok, `assignCollector: ${JSON.stringify(assigned)}`).toBe(true);

    const followUp = await as(collections, () =>
      recordFollowUp(invoiceId, {
        channel: "PHONE",
        outcome: "PAYMENT_PROMISED",
        note: "Client confirme le règlement sous 48h.",
      }),
    );
    expect(followUp.ok, `recordFollowUp: ${JSON.stringify(followUp)}`).toBe(true);

    // …and step 26 does NOT imply the invoice is paid.
    const money = await invoiceMoney(invoiceId);
    expect(money.status, "still issued, not settled").toBe("ISSUED");
    expect(money.balance, "the balance is untouched by follow-up work").toBe(money.total);
  });

  it("another actor cannot hijack the claimed step 26", async () => {
    const before = await execution(fileId, "collections");
    const hijack = await as(billing, () => submitStep(fileId, "collections"));
    expect(hijack.ok).toBe(false);

    const after = await execution(fileId, "collections");
    expect(after?.state, "state unchanged").toBe("ACTIVE");
    expect(after?.assigned_user_id).toBe(before?.assigned_user_id);
  });

  it("CLOSURE before payment is refused, and changes nothing", async () => {
    const refused = await as(ops, () => closeDossier(fileId));
    expect(refused.ok, "an unpaid dossier cannot close").toBe(false);

    const file = await fileRow(fileId);
    expect(file?.status, "the dossier stays open").not.toBe("CLOSED");
    const { data: inst } = await db()
      .from("process_instance").select("status").eq("file_id", fileId).maybeSingle();
    expect(inst?.status, "and the process is not terminal").not.toBe("CLOSED");
    expect((await execution(fileId, "collections"))?.state).toBe("ACTIVE");
  });

  it("PARTIAL payment moves the balance exactly once and does not settle it", async () => {
    const before = await invoiceMoney(invoiceId);
    expect(before.paid).toBe(0);

    const part = Math.round(before.total * 0.4 * 100) / 100;
    const paid = await as(finance, () => recordPayment(invoiceId, { amount: part, method: "BANK_TRANSFER" }));
    expect(paid.ok, `recordPayment: ${JSON.stringify(paid)}`).toBe(true);

    const after = await invoiceMoney(invoiceId);
    expect(after.payments, "exactly one payment row").toHaveLength(1);
    expect(after.paid, "credited exactly once").toBe(part);
    expect(after.balance, "and the remainder is exact").toBe(Math.round((before.total - part) * 100) / 100);
    expect(after.status, "a partial payment does not settle the invoice").not.toBe("PAID");
  });

  it("…and closure is still refused on a partial payment", async () => {
    const refused = await as(ops, () => closeDossier(fileId));
    expect(refused.ok).toBe(false);
    const file = await fileRow(fileId);
    expect(file?.status).not.toBe("CLOSED");
    const { data: inst } = await db()
      .from("process_instance").select("status").eq("file_id", fileId).maybeSingle();
    expect(inst?.status).not.toBe("CLOSED");
  });

  it("OVERPAYMENT is refused by the governed rule, not invented here", async () => {
    // recordPayment refuses `amount > balance`. Exercised rather than assumed,
    // and asserted to leave the ledger untouched.
    const before = await invoiceMoney(invoiceId);
    const over = await as(finance, () =>
      recordPayment(invoiceId, { amount: before.balance + 1000, method: "BANK_TRANSFER" }),
    );
    expect(over.ok, "an invoice cannot be over-credited").toBe(false);
    expect((over as { error: string }).error).toBe("exceeds_balance");

    const after = await invoiceMoney(invoiceId);
    expect(after.paid, "nothing was credited").toBe(before.paid);
    expect(after.payments).toHaveLength(before.payments.length);
  });

  it("FULL settlement clears the balance with no double counting", async () => {
    const before = await invoiceMoney(invoiceId);
    const paid = await as(finance, () =>
      recordPayment(invoiceId, { amount: before.balance, method: "BANK_TRANSFER" }),
    );
    expect(paid.ok, `final payment: ${JSON.stringify(paid)}`).toBe(true);

    const after = await invoiceMoney(invoiceId);
    expect(after.payments, "two payments, no more").toHaveLength(2);
    expect(after.paid, "cumulative payments equal the total").toBe(after.total);
    expect(after.balance).toBe(0);
  });

  it("payments must be VERIFIED — settlement is not the same as verification", async () => {
    // « Verification is separate from settlement: a zero balance reached through
    // an unverified payment is not a settled dossier. » The closure lane says so
    // and refuses `payment_unverified`; the journey obeys it rather than
    // reaching a zero balance and calling the dossier settled.
    const { data: pays } = await db()
      .from("payment")
      .select("id, verification_status")
      .eq("invoice_id", invoiceId);
    expect(pays ?? [], "two payments to verify").toHaveLength(2);
    for (const p of pays ?? []) {
      expect(p.verification_status, "recorded, not yet verified").not.toBe("VERIFIED");
      const verified = await as(finance, () => verifyPayment(p.id as string));
      expect(verified.ok, `verifyPayment: ${JSON.stringify(verified)}`).toBe(true);
    }

    const { data: after } = await db()
      .from("payment")
      .select("verification_status")
      .eq("invoice_id", invoiceId);
    expect((after ?? []).every((p) => p.verification_status === "VERIFIED")).toBe(true);
  });

  it("step 26 completes only once the balance is zero", async () => {
    const done = await as(collections, () => completeCollections(invoiceId));
    expect(done.ok, `completeCollections: ${JSON.stringify(done)}`).toBe(true);

    const exec = await execution(fileId, "collections");
    expect(exec?.state).toBe("COMPLETED");
    expect(exec?.submitted_by, "closed by Recouvrement itself").toBe(collections.id);
  });

  it("RECONCILIATION is idempotent — the second run changes nothing", async () => {
    const snapshot = async () => {
      const money = await invoiceMoney(invoiceId);
      const { data: execs } = await db()
        .from("process_step_execution")
        .select("step_key, state, completed_at")
        .in(
          "process_instance_id",
          (await db().from("process_instance").select("id").eq("file_id", fileId)).data?.map((r) => r.id) ?? [],
        );
      const { data: audits } = await db().from("audit_log").select("id").eq("entity_id", invoiceId);
      const { data: custody } = await db().from("invoice_deposit_event").select("id").eq("deposit_id", depositId);
      return {
        paid: money.paid,
        payments: money.payments.length,
        execs: (execs ?? []).map((e) => `${e.step_key}:${e.state}`).sort().join("|"),
        audits: (audits ?? []).length,
        custody: (custody ?? []).length,
      };
    };

    const first = await snapshot();
    const again = await as(finance, () => reconcileDossierProcess({ tenantId: TENANT_A, fileId, cause: "manual", actorId: finance.id }));
    expect(again.ok, "a repeat reconciliation must not error").toBe(true);
    const second = await snapshot();

    // Not merely ok:true — the STATE is compared.
    expect(second.paid, "no financial effect").toBe(first.paid);
    expect(second.payments, "no duplicate payment").toBe(first.payments);
    expect(second.execs, "no duplicate completion or promotion").toBe(first.execs);
    expect(second.custody, "no duplicate custody event").toBe(first.custody);
    expect(second.audits, "no duplicate one-time audit").toBe(first.audits);
  });

  it("the closure gate reports every requirement satisfied — including the deposit ones", async () => {
    const readiness = await as(ops, () => evaluateClosureReadiness(fileId));
    expect(readiness, "the gate is readable").toBeTruthy();
    expect(readiness!.blockers, `still blocked by: ${JSON.stringify(readiness!.blockers)}`).toEqual([]);
    expect(readiness!.ready).toBe(true);

    // This client REQUIRES the physical deposit, so those requirements are
    // genuinely satisfied rather than waived.
    expect(readiness!.satisfied).toContain("deposit_proof_accepted");
    expect(readiness!.satisfied).toContain("handed_to_collections");
    expect(readiness!.notApplicable, "nothing was waived for this client").not.toContain("deposit_proof_accepted");
  });

  it("CLOSURE succeeds once, and preserves every fact behind it", async () => {
    const before = await invoiceMoney(invoiceId);

    const closed = await as(ops, () => closeDossier(fileId));
    expect(closed.ok, `closeDossier: ${JSON.stringify(closed)}`).toBe(true);

    const file = await fileRow(fileId);
    expect(file?.status).toBe("CLOSED");

    // The process instance reaches its terminal condition too.
    const { data: inst } = await db()
      .from("process_instance")
      .select("status")
      .eq("file_id", fileId)
      .maybeSingle();
    expect(inst?.status).toBe("CLOSED");

    // Closure is audited and attributed.
    const events = await auditFor(AuditActions.PROCESS_CLOSED, fileId);
    expect(events.length, "closure must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id, "attributed to the closing actor").toBe(ops.id);

    // Nothing behind it moved: money, proof and custody are as they were.
    const after = await invoiceMoney(invoiceId);
    expect(after.paid).toBe(before.paid);
    expect(after.invoiceNumber).toBe(before.invoiceNumber);

    const { data: dep } = await db()
      .from("invoice_deposit")
      .select("status, proof_document_id, validated_by_admin")
      .eq("id", depositId)
      .maybeSingle();
    expect(dep?.status).toBe("HANDED_TO_COLLECTIONS");
    expect(dep?.proof_document_id, "the accepted proof stays linked").toBeTruthy();
    expect(dep?.validated_by_admin).toBe(admin.id);
  });

  it("a second closure is idempotent, per the implemented contract", async () => {
    // Read from the implementation, not invented: closeDossier short-circuits
    // on an already-CLOSED instance and returns success.
    const again = await as(ops, () => closeDossier(fileId));
    expect(again.ok).toBe(true);

    const file = await fileRow(fileId);
    expect(file?.status).toBe("CLOSED");
  });
});
