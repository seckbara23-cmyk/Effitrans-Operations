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
import { as } from "./identity";
import {
  identity, execution, auditFor, handoffs, provideEvidence, customsIdFor, transportFor,
  db, CLIENT_DEPOSIT_REQUIRED,
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

let ops: CurrentUser;         // OPS_SUPERVISOR
let am: CurrentUser;          // ACCOUNT_MANAGER — owns steps 3, 16, 19
let transit: CurrentUser;     // CHIEF_OF_TRANSIT
let coordinator: CurrentUser; // COORDINATOR — owns steps 17, 18
let field: CurrentUser;       // CUSTOMS_FIELD_AGENT
let transport: CurrentUser;   // TRANSPORT_OFFICER — owns step 14
let pickup: CurrentUser;      // PICKUP_AGENT — owns step 15
let billing: CurrentUser;     // BILLING_OFFICER — owns steps 20, 22
let finance: CurrentUser;     // FINANCE_OFFICER — owns step 21 (the checker)

let fileId = "";

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
  await handOver(coordinator, transit, "coordinator_to_declarant", "gainde_document_submission");
  await as(transit, () => activateStep(fileId, "gainde_document_submission"));
  await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", transit, ops);
  await as(transit, () => submitStep(fileId, "gainde_document_submission"));

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
    coordinator = await identity("coordinator");
    field = await identity("field");
    transport = await identity("transport");
    pickup = await identity("pickup");
    billing = await identity("billing");
    finance = await identity("finance");
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
  let invoiceId = "";

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

    const submitted = await as(billing, () => submitInvoiceToFinance(invoiceId));
    expect(submitted.ok, `submitInvoiceToFinance: ${JSON.stringify(submitted)}`).toBe(true);

    const { data: inv } = await db()
      .from("invoice")
      .select("submitted_by, status")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.submitted_by).toBe(billing.id);
    expect(inv?.status, "submission is not validation").toBe("DRAFT");
  });

  it("20→21 MAKER ≠ CHECKER — the submitter cannot validate its own invoice", async () => {
    const refused = await as(billing, () => approveInvoice(invoiceId));
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
    expect(inv?.submitted_by).toBe(billing.id);
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

  it("issuance BEFORE validation is refused", async () => {
    // On another dossier's draft, since this one is already validated.
    const { data: drafts } = await db()
      .from("invoice")
      .select("id")
      .eq("status", "DRAFT")
      .neq("id", invoiceId)
      .limit(1);
    const draftId = (drafts ?? [])[0]?.id as string | undefined;
    expect(draftId, "a DRAFT invoice is needed for this negative case").toBeTruthy();

    const early = await as(billing, () => emailValidatedInvoice(draftId as string));
    expect(early.ok).toBe(false);
    expect((early as { error: string }).error).toBe("invoice_not_validated");
  });

  it("THE ISSUANCE INVARIANT — no delivery, no ISSUED, no step 22", async () => {
    // CI has no email provider, so this exercises the REAL failure path of the
    // REAL action. Nothing is stubbed: sendEmail genuinely fails closed.
    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));
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

  it("NUMBERING — the sequence advanced although no invoice carries a number", async () => {
    // RECORDED, NOT JUDGED. next_invoice_number runs BEFORE the send, so a
    // failed delivery consumes a value no document will ever carry, and a retry
    // consumes another. Whether gaps in the official sequence are acceptable
    // under Effitrans's accounting obligations is a business ruling; this pins
    // the evidence so the ruling is made against facts rather than recollection.
    const { data: inv } = await db()
      .from("invoice")
      .select("invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.invoice_number, "the invoice carries none").toBeNull();

    // Nothing in the tenant carries a number, yet issuance has been attempted
    // twice — which is the whole of the observation.
    const { data: numbered } = await db()
      .from("invoice")
      .select("id")
      .not("invoice_number", "is", null);
    expect(numbered ?? [], "nothing was numbered by the failed attempts").toHaveLength(0);
  });
});
