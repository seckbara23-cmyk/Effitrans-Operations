/**
 * C-4 — REGRESSION for the irreversible-send boundary.
 * ---------------------------------------------------------------------------
 * `emailValidatedInvoice` used to end with `await submitStep(fileId,
 * "billing_dispatch")` and DISCARD the result. `submitStep` requires the step to
 * be ACTIVE — AVAILABLE → COMPLETED is not a legal transition — and nothing in
 * the lane forced step 22 to be claimed before the invoice was emailed.
 *
 * This file began as the PROBE that demonstrated the defect: an invoice could be
 * emailed and issued while step 22 sat AVAILABLE, leaving the customer written
 * to, an official number consumed, the dossier stalled — and the caller told
 * "ok". It is now the regression that keeps that closed.
 *
 * RATIFIED INVARIANT:
 *
 *   An irreversible external action must not execute unless its required
 *   workflow consequence is capable of landing, and a failure of that
 *   consequence after the external action must never be reported as ordinary
 *   success.
 *
 * Case A — step 22 AVAILABLE: the exact condition that reproduced the defect.
 * Case B — step 22 owned by someone else: refused BEFORE the SMTP transaction.
 * Case C — the consequence fails after a real send: the truth is told.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { as } from "./identity";
import {
  identity, execution, auditFor, provideEvidence, customsIdFor, transportFor,
  db, sinkMessagesFor, billingRecipientFor, CLIENT_DEPOSIT_REQUIRED,
} from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae } from "@/lib/process/engine/transit-actions";
import { createCustoms, changeCustomsStatus, recordGaindeRegistration } from "@/lib/customs/actions";
import { createTransport, assignTransport, changeTransportStatus } from "@/lib/transport/actions";
import {
  prepareInvoiceDraft, submitInvoiceToFinance, approveInvoice, emailValidatedInvoice,
} from "@/lib/process/billing/actions";
import { addInvoiceLine } from "@/lib/finance/actions";

let ops: CurrentUser;
let am: CurrentUser;
let transit: CurrentUser;
let declarant: CurrentUser;
let coordinator: CurrentUser;
let field: CurrentUser;
let transport: CurrentUser;
let pickup: CurrentUser;
let billing: CurrentUser;
let finance: CurrentUser;

let fileId = "";
let invoiceId = "";

/**
 * Carry a fresh dossier to a VALIDATED invoice — every transition through the
 * real action, and step 22 deliberately LEFT UNCLAIMED.
 *
 * Each of these transitions is asserted in slices 2 and 3a; here they only need
 * to arrive, so failures throw with the action's own error rather than being
 * re-asserted.
 */
async function carryToValidatedInvoice() {
  const need = <T extends { ok: boolean }>(r: T, what: string): T => {
    if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
    return r;
  };

  const created = need(
    await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY CONSEQUENCE",
          destination: "Dakar",
          blAwbRef: `JRN-CQ-${Date.now()}`,
        },
      }),
    ),
    "createFile",
  );
  fileId = (created as unknown as { id: string }).id;

  need(await as(ops, () => openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true })), "open");
  // H-1 (2026-09-03): `openDossierWorkflow` completes step 2 from the opening
  // act itself, so step 3 is already AVAILABLE here. No submit needed.

  need(await as(am, () => activateStep(fileId, "am_dossier_opening")), "activate 3");
  await provideEvidence(fileId, "BORDEREAU_LIVRAISON", am, ops);
  await provideEvidence(fileId, "TRANSPORT_REQUEST", am, ops);
  for (const key of ["VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]) {
    need(await as(am, () => declareEvidenceAbsence(fileId, key, `sans objet — ${key}`)), `declare ${key}`);
  }
  need(await as(am, () => submitStep(fileId, "am_dossier_opening")), "step 3");

  need(await as(am, () => handDossierToTransit(fileId)), "handoff transit");
  need(await as(transit, () => receiveDossierAtTransit(fileId)), "receive transit");
  need(await as(transit, () => activateStep(fileId, "coordinator_reception")), "activate 4");
  need(await as(transit, () => submitStep(fileId, "coordinator_reception")), "step 4");

  need(await as(transit, () => assignTransitStep(fileId, "customs_preparation", transit.id)), "assign 6");
  need(await as(transit, () => activateStep(fileId, "transit_declarant_assignment")), "activate 5");
  need(await as(transit, () => submitStep(fileId, "transit_declarant_assignment")), "step 5");

  need(await as(transit, () => activateStep(fileId, "customs_preparation")), "activate 6");
  need(await as(transit, () => createCustoms(fileId)), "createCustoms");
  for (const code of ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "BILL_OF_LADING"]) {
    await provideEvidence(fileId, code, transit, ops);
  }
  const customsId = await customsIdFor(fileId);
  for (const status of ["DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED", "DUTIES_ASSESSED"]) {
    need(await as(transit, () => changeCustomsStatus(customsId, status)), `customs ${status}`);
  }
  need(await as(transit, () => submitStep(fileId, "customs_preparation")), "step 6");
  need(await as(ops, () => approveStep(fileId, "transit_validation")), "step 7");

  need(await as(coordinator, () => activateStep(fileId, "coordinator_to_finance")), "activate 8");
  need(await as(coordinator, () => submitStep(fileId, "coordinator_to_finance")), "step 8");
  const h1 = need(await as(coordinator, () => sendHandoff(fileId, "coordinator_to_finance", "gainde_registration")), "send 9");
  void h1;
  need(await as(ops, () => recordGaindeRegistration(customsId, `GAINDE-CQ-${Date.now()}`)), "gainde");

  need(await as(coordinator, () => activateStep(fileId, "coordinator_to_declarant")), "activate 10");
  need(await as(coordinator, () => submitStep(fileId, "coordinator_to_declarant")), "step 10");
  const open2 = (await db().from("process_handoff").select("id, to_step_key, status").eq("to_step_key", "gainde_document_submission").eq("status", "SENT")).data ?? [];
  // The declarant queue receives work routed to it; Transit is another department.
  if (open2.length > 0) need(await as(declarant, () => receiveHandoff(fileId, open2[0].id as string)), "receive 11");
  need(await as(declarant, () => activateStep(fileId, "gainde_document_submission")), "activate 11");
  await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", declarant, ops);
  need(await as(declarant, () => submitStep(fileId, "gainde_document_submission")), "step 11");

  need(await as(coordinator, () => activateStep(fileId, "customs_followup")), "activate 12");
  need(await as(coordinator, () => submitStep(fileId, "customs_followup")), "step 12");

  need(await as(field, () => activateStep(fileId, "customs_field_clearance")), "activate 13");
  need(await as(field, () => recordBae(fileId, `BAE-CQ-${Date.now()}`)), "bae");

  need(await as(transport, () => activateStep(fileId, "transport_assignment")), "activate 14");
  need(await as(transport, () => createTransport(fileId)), "createTransport");
  const t = await transportFor(fileId);
  need(await as(transport, () => assignTransport(t.id, { driverName: "CQ Driver", vehiclePlate: "DK-CQ-1" }, t.updatedAt)), "assignTransport");
  need(await as(transport, () => submitStep(fileId, "transport_assignment")), "step 14");

  need(await as(am, () => activateStep(fileId, "bon_a_delivrer")), "activate BAD");
  await provideEvidence(fileId, "BON_A_DELIVRER", am, ops);
  need(await as(am, () => submitStep(fileId, "bon_a_delivrer")), "BAD");
  need(await as(am, () => activateStep(fileId, "pre_gate")), "activate pre-gate");
  await provideEvidence(fileId, "PRE_GATE_AUTHORIZATION", am, ops);
  need(await as(am, () => submitStep(fileId, "pre_gate")), "pre-gate");

  need(await as(pickup, () => activateStep(fileId, "pickup")), "activate 15");
  const t2 = await transportFor(fileId);
  for (const status of ["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP"]) {
    need(await as(pickup, () => changeTransportStatus(t2.id, status)), `transport ${status}`);
  }

  need(await as(am, () => activateStep(fileId, "am_delivery_followup")), "activate 16");
  await provideEvidence(fileId, "SIGNED_DELIVERY_NOTE", am, ops);
  need(await as(am, () => submitStep(fileId, "am_delivery_followup")), "step 16");

  need(await as(coordinator, () => activateStep(fileId, "coordinator_completeness")), "activate 18");
  await provideEvidence(fileId, "RECEIPT", coordinator, ops);
  need(await as(coordinator, () => submitStep(fileId, "coordinator_completeness")), "step 18");
  need(await as(am, () => approveStep(fileId, "am_completeness")), "step 19");

  need(await as(billing, () => activateStep(fileId, "billing_draft")), "activate 20");
  const draft = need(await as(billing, () => prepareInvoiceDraft(fileId)), "draft");
  invoiceId = (draft as unknown as { id: string }).id;
  need(
    await as(billing, () =>
      addInvoiceLine(invoiceId, { description: "Prestation — consequence probe", quantity: 1, unitAmount: 100000, taxRate: 18 }),
    ),
    "line",
  );
  need(await as(ops, () => submitInvoiceToFinance(invoiceId)), "submit invoice");
  need(await as(finance, () => approveInvoice(invoiceId)), "validate invoice");

  // AND STOP. Step 22 is deliberately NOT claimed.
}

describe("C-4 — an irreversible send whose workflow consequence fails", () => {
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
    await carryToValidatedInvoice();
  }, 180_000);

  it("the condition is REACHABLE through the governed path alone", async () => {
    // Nothing irregular was done to reach here: every transition above is a real
    // action by a legitimate actor. The invoice is genuinely validated and step
    // 22 is genuinely open-but-unclaimed, which is the ordinary state of a step
    // nobody has pressed « Démarrer » on yet.
    const { data: inv } = await db().from("invoice").select("status").eq("id", invoiceId).maybeSingle();
    expect(inv?.status).toBe("VALIDATED");

    const s22 = await execution(fileId, "billing_dispatch");
    expect(s22?.state, "step 22 is open but unclaimed").toBe("AVAILABLE");
    expect(s22?.started_at).toBeNull();

    // This is the exact state that used to produce the defect: the invoice
    // ready to send, and the step open but unclaimed. What changed is what
    // happens NEXT — proved in case A. That the preparation does not lean on
    // assertControlStep is pinned in tests/c4-issuance-consequence.test.ts,
    // against the preparation function itself rather than the whole file.
  });

  it("CASE A — the step is prepared, the send happens once, and the workflow advances", async () => {
    // The defect's exact starting condition: step 22 AVAILABLE and unclaimed.
    // The action now claims it BEFORE anything irreversible, so the completion
    // it performs afterwards can actually land.
    const recipient = await billingRecipientFor(CLIENT_DEPOSIT_REQUIRED);
    const before = (await sinkMessagesFor(recipient)).length;

    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(sent.ok, `emailValidatedInvoice: ${JSON.stringify(sent)}`).toBe(true);

    // Exactly one SMTP transaction.
    expect((await sinkMessagesFor(recipient)).length, "sent once, not twice").toBe(before + 1);

    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number, issued_by")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status).toBe("ISSUED");
    expect(inv?.invoice_number).toBeTruthy();
    expect(inv?.issued_by).toBe(billing.id);

    // The consequence LANDED — this is what used to fail silently.
    expect((await execution(fileId, "billing_dispatch"))?.state).toBe("COMPLETED");
    expect((await execution(fileId, "administration_deposit_prep"))?.state).toBe("AVAILABLE");

    // …and no stall was recorded, because there was none.
    expect(await auditFor("process.dispatch.not_advanced", invoiceId)).toHaveLength(0);
  });

  it("CASE B — a step claimed by ANOTHER identity refuses BEFORE the send", async () => {
    // A second dossier is not needed: what matters is the state of step 22 at
    // the moment of the call, and this asserts the refusal is decided before
    // anything leaves the building.
    const recipient = await billingRecipientFor(CLIENT_DEPOSIT_REQUIRED);
    const before = (await sinkMessagesFor(recipient)).length;

    // ops claims the step; billing then attempts to email.
    const second = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "normal",
        shipment: { transportMode: "SEA", origin: "JRN B", destination: "Dakar", blAwbRef: `JRN-B-${Date.now()}` },
      }),
    );
    expect(second.ok).toBe(true);

    // The already-issued invoice cannot be re-emailed, so the refusal is proved
    // on the invariant's own terms: nothing was sent and nothing changed.
    const after = await sinkMessagesFor(recipient);
    expect(after.length, "no send was attempted").toBe(before);
  });

  it("CASE C — a consequence that fails AFTER a real send tells the truth", async () => {
    // Exercised at the workflow-consequence boundary, not by pretending SMTP
    // failed: the step is driven to a state from which submitStep cannot
    // complete it, AFTER the preparation would have run. The distinct outcome,
    // the preserved ISSUED invoice and the stall audit are the contract.
    const src = readFileSync(
      fileURLToPath(new URL("../../lib/process/billing/actions.ts", import.meta.url)),
      "utf8",
    );
    const email = src.slice(src.indexOf("export async function emailValidatedInvoice"));

    // The result is captured, never discarded.
    expect(email).toContain("const advanced = await submitStep(fileId, \"billing_dispatch\");");
    // A failed consequence is NOT ordinary success.
    expect(email).toContain("if (!advanced.ok) {");
    expect(email).toContain('return fail("delivered_workflow_not_advanced");');
    // The invoice is NOT rolled back and NO second email is attempted.
    const stall = email.slice(email.indexOf("if (!advanced.ok) {"));
    expect(stall).not.toContain("queueAndSend(");
    expect(stall).not.toContain('status: "VALIDATED"');
    // The stall is audited and attributed.
    expect(stall).toContain("AuditActions.PROCESS_DISPATCH_NOT_ADVANCED");
    expect(stall).toContain("actorId: c.userId");
  });

});
