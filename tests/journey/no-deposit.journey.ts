/**
 * C-4 — the NO-DEPOSIT control fixture.
 * ---------------------------------------------------------------------------
 * The deposit-required journey proves the physical-deposit branch works. This
 * one proves it is CONDITIONAL — that its absence is a legitimate consequence of
 * client configuration and not a gap someone has to fill with invented courier
 * activity.
 *
 * The two claims it exists to separate:
 *
 *   deposit-required client   → an accepted deposit proof is REQUIRED
 *   no-deposit client         → its absence is legitimate and blocks nothing
 *
 * Everything else must still hold. A client who does not receive a paper
 * invoice still owes the money: billing, issuance, verified payment, settlement
 * and every non-deposit closure gate are unchanged, and this file asserts each
 * of them refuses when unsatisfied rather than assuming the happy path.
 *
 * NOTHING IS FABRICATED. There is no courier, no deposit record and no proof
 * document anywhere in this file. Steps 23–25 reach SKIPPED through the engine's
 * own `skipStep`, with a stated reason and an audited actor — the same canonical
 * mechanism that skips cotation on a dossier without a devis.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as } from "./identity";
import {
  identity, execution, auditFor, provideEvidence, customsIdFor, transportFor,
  db, sinkMessagesFor, billingRecipientFor, fileRow, invoiceMoney, CLIENT_NO_DEPOSIT,
} from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { skipStep } from "@/lib/process/engine/structures-actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae } from "@/lib/process/engine/transit-actions";
import { createCustoms, changeCustomsStatus, recordGaindeRegistration } from "@/lib/customs/actions";
import { createTransport, assignTransport, changeTransportStatus } from "@/lib/transport/actions";
import {
  prepareInvoiceDraft, submitInvoiceToFinance, approveInvoice, emailValidatedInvoice,
} from "@/lib/process/billing/actions";
import { addInvoiceLine, recordPayment, verifyPayment } from "@/lib/finance/actions";
import { handInvoiceToAdministration } from "@/lib/deposit/actions";
import {
  assignCollector, completeCollections, evaluateClosureReadiness, closeDossier,
} from "@/lib/collections/actions";

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
let collections: CurrentUser;

let fileId = "";
let invoiceId = "";

const need = <T extends { ok: boolean }>(r: T, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r;
};

/** Carry the no-deposit dossier to a VALIDATED invoice, all through real actions. */
async function carryToValidatedInvoice() {
  const created = need(
    await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_NO_DEPOSIT,
        priority: "normal",
        shipment: {
          transportMode: "SEA",
          origin: "JOURNEY NODEP",
          destination: "Dakar",
          blAwbRef: `JRN-ND-${Date.now()}`,
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

  need(await as(ops, () => handDossierToTransit(fileId)), "handoff transit");
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
  need(await as(coordinator, () => sendHandoff(fileId, "coordinator_to_finance", "gainde_registration")), "send 9");
  need(await as(ops, () => recordGaindeRegistration(customsId, `GAINDE-ND-${Date.now()}`)), "gainde");

  need(await as(coordinator, () => activateStep(fileId, "coordinator_to_declarant")), "activate 10");
  need(await as(coordinator, () => submitStep(fileId, "coordinator_to_declarant")), "step 10");
  const open2 = (await db().from("process_handoff").select("id, to_step_key, status")
    .eq("to_step_key", "gainde_document_submission").eq("status", "SENT")).data ?? [];
  if (open2.length > 0) need(await as(declarant, () => receiveHandoff(fileId, open2[0].id as string)), "receive 11");
  need(await as(declarant, () => activateStep(fileId, "gainde_document_submission")), "activate 11");
  await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", declarant, ops);
  need(await as(declarant, () => submitStep(fileId, "gainde_document_submission")), "step 11");

  need(await as(coordinator, () => activateStep(fileId, "customs_followup")), "activate 12");
  need(await as(coordinator, () => submitStep(fileId, "customs_followup")), "step 12");

  need(await as(field, () => activateStep(fileId, "customs_field_clearance")), "activate 13");
  need(await as(field, () => recordBae(fileId, `BAE-ND-${Date.now()}`)), "bae");

  need(await as(transport, () => activateStep(fileId, "transport_assignment")), "activate 14");
  need(await as(transport, () => createTransport(fileId)), "createTransport");
  const t = await transportFor(fileId);
  need(await as(transport, () => assignTransport(t.id, { driverName: "ND Driver", vehiclePlate: "DK-ND-1" }, t.updatedAt)), "assign transport");
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
  const t3 = await transportFor(fileId);
  for (const status of ["IN_TRANSIT", "DELIVERED"]) {
    need(await as(transport, () => changeTransportStatus(t3.id, status)), `transport ${status}`);
  }

  need(await as(coordinator, () => activateStep(fileId, "transport_docs_transmission")), "activate transmission");
  need(await as(coordinator, () => submitStep(fileId, "transport_docs_transmission")), "transmission");

  need(await as(coordinator, () => activateStep(fileId, "coordinator_completeness")), "activate 18");
  await provideEvidence(fileId, "RECEIPT", coordinator, ops);
  need(await as(coordinator, () => submitStep(fileId, "coordinator_completeness")), "step 18");
  need(await as(am, () => approveStep(fileId, "am_completeness")), "step 19");

  need(await as(billing, () => activateStep(fileId, "billing_draft")), "activate 20");
  const draft = need(await as(billing, () => prepareInvoiceDraft(fileId)), "draft");
  invoiceId = (draft as unknown as { id: string }).id;
  need(
    await as(billing, () =>
      addInvoiceLine(invoiceId, { description: "Prestation — client sans dépôt", quantity: 1, unitAmount: 180000, taxRate: 18 }),
    ),
    "line",
  );
  need(await as(ops, () => submitInvoiceToFinance(invoiceId)), "submit invoice");
  need(await as(finance, () => approveInvoice(invoiceId)), "validate invoice");
}

describe("C-4 — the NO-DEPOSIT control fixture", () => {
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
    collections = await identity("collections");
    await carryToValidatedInvoice();
  }, 180_000);

  it("the client really is configured without physical deposit", async () => {
    // The whole fixture is meaningless if this is not true, so it is asserted
    // rather than assumed — and read from the CLIENT, which is the only place
    // the requirement is ever declared.
    const { data: client } = await db()
      .from("client")
      .select("requires_physical_invoice_deposit")
      .eq("id", CLIENT_NO_DEPOSIT)
      .maybeSingle();
    expect(client?.requires_physical_invoice_deposit).toBe(false);
  });

  it("issuance is unchanged — a paperless client still gets a real invoice", async () => {
    const recipient = await billingRecipientFor(CLIENT_NO_DEPOSIT);
    const before = (await sinkMessagesFor(recipient)).length;

    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(sent.ok, `emailValidatedInvoice: ${JSON.stringify(sent)}`).toBe(true);
    expect((await sinkMessagesFor(recipient)).length, "delivered once").toBe(before + 1);

    const money = await invoiceMoney(invoiceId);
    expect(money.status).toBe("ISSUED");
    expect(money.invoiceNumber, "an official number all the same").toBeTruthy();
    expect((await execution(fileId, "billing_dispatch"))?.state).toBe("COMPLETED");
  });

  it("THE CONDITIONALITY — Administration REFUSES a deposit this client never asked for", async () => {
    // The positive claim of this fixture. Not "we skipped it", but "the platform
    // itself refuses to open a deposit for a client configured without one".
    const refused = await as(billing, () => handInvoiceToAdministration(invoiceId));
    expect(refused.ok, "a deposit is NEVER implicitly required").toBe(false);
    expect((refused as { error: string }).error).toBe("deposit_not_required");

    // …and no deposit record exists anywhere for this dossier.
    const { data: deposits } = await db().from("invoice_deposit").select("id").eq("file_id", fileId);
    expect(deposits ?? [], "no deposit was fabricated").toHaveLength(0);
  });

  it("steps 23–25 reach SKIPPED through the ENGINE, with a reason and an actor", async () => {
    // Not direct mutation, and not left dangling: the same canonical skipStep
    // that skips cotation on a dossier without a devis.
    for (const stepKey of ["administration_deposit_prep", "courier_deposit", "administration_proof_handoff"]) {
      const skipped = await as(ops, () =>
        skipStep(fileId, stepKey, {
          reason: "Client sans dépôt physique de facture — branche non applicable.",
          source: "MANUAL",
        }),
      );
      expect(skipped.ok, `skip ${stepKey}: ${JSON.stringify(skipped)}`).toBe(true);
      expect((await execution(fileId, stepKey))?.state, stepKey).toBe("SKIPPED");
    }

    // Skipping is audited — an inapplicable branch is accounted for, never
    // silently absent.
    const exec = await execution(fileId, "administration_deposit_prep");
    const events = await auditFor("process.step.skipped", exec!.id as string);
    expect(events.length, "a skip must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id).toBe(ops.id);

    // …and step 26 opens from the skipped branch, exactly as from a completed one.
    expect((await execution(fileId, "collections"))?.state).toBe("AVAILABLE");
  });

  it("every NON-deposit gate is still enforced — unpaid cannot close", async () => {
    const refused = await as(ops, () => closeDossier(fileId));
    expect(refused.ok, "no deposit does not mean no payment").toBe(false);

    const file = await fileRow(fileId);
    expect(file?.status).not.toBe("CLOSED");
  });

  it("…and an UNVERIFIED payment cannot close either", async () => {
    const money = await invoiceMoney(invoiceId);
    const paid = await as(finance, () => recordPayment(invoiceId, { amount: money.balance, method: "BANK_TRANSFER" }));
    expect(paid.ok, `recordPayment: ${JSON.stringify(paid)}`).toBe(true);

    const after = await invoiceMoney(invoiceId);
    expect(after.balance, "balance is zero…").toBe(0);

    // …and that is still not a settled dossier.
    const refused = await as(ops, () => closeDossier(fileId));
    expect(refused.ok, "a zero balance through unverified payment is not settlement").toBe(false);
    expect((await fileRow(fileId))?.status).not.toBe("CLOSED");
  });

  it("Recouvrement completes step 26 on the settled dossier", async () => {
    const { data: pays } = await db().from("payment").select("id").eq("invoice_id", invoiceId);
    for (const p of pays ?? []) {
      expect((await as(finance, () => verifyPayment(p.id as string))).ok).toBe(true);
    }

    const open = (await db().from("process_handoff").select("id, to_step_key, status")
      .eq("to_step_key", "collections").eq("status", "SENT")).data ?? [];
    if (open.length > 0) {
      // No Administration handoff exists on this dossier — the branch was
      // skipped — so step 26 is reached by promotion. If one somehow exists it
      // must still be received explicitly.
      need(await as(collections, () => receiveHandoff(fileId, open[0].id as string)), "receive 26");
    }

    need(await as(collections, () => activateStep(fileId, "collections")), "activate 26");
    need(await as(collections, () => assignCollector(invoiceId, collections.id)), "assign collector");
    const done = await as(collections, () => completeCollections(invoiceId));
    expect(done.ok, `completeCollections: ${JSON.stringify(done)}`).toBe(true);
    expect((await execution(fileId, "collections"))?.state).toBe("COMPLETED");
  });

  it("the closure gate marks the deposit requirements NOT APPLICABLE — not satisfied", async () => {
    const readiness = await as(ops, () => evaluateClosureReadiness(fileId));
    expect(readiness, "the gate is readable").toBeTruthy();
    expect(readiness!.blockers, `blocked by: ${JSON.stringify(readiness!.blockers)}`).toEqual([]);

    // THE DISTINCTION THIS FIXTURE EXISTS FOR. On the deposit-required dossier
    // these two are SATISFIED, because a proof was produced and accepted. Here
    // they are NOT APPLICABLE, because the client never required one. A gate
    // that merely reported them satisfied would be indistinguishable from one
    // that had been waived.
    expect(readiness!.notApplicable).toContain("deposit_proof_accepted");
    expect(readiness!.notApplicable).toContain("handed_to_collections");
    expect(readiness!.satisfied, "nothing about a deposit was 'satisfied' here")
      .not.toContain("deposit_proof_accepted");
  });

  it("closure succeeds — through the governed act, with nothing fabricated", async () => {
    const closed = await as(ops, () => closeDossier(fileId));
    expect(closed.ok, `closeDossier: ${JSON.stringify(closed)}`).toBe(true);

    expect((await fileRow(fileId))?.status).toBe("CLOSED");
    const { data: inst } = await db().from("process_instance").select("status").eq("file_id", fileId).maybeSingle();
    expect(inst?.status).toBe("CLOSED");

    // The proof that nothing was invented to get here.
    const { data: deposits } = await db().from("invoice_deposit").select("id").eq("file_id", fileId);
    expect(deposits ?? [], "closed with no deposit record at all").toHaveLength(0);
    const { data: proofs } = await db()
      .from("document")
      .select("id")
      .eq("file_id", fileId)
      .eq("type_code", "PROOF_OF_DEPOSIT");
    expect(proofs ?? [], "and no proof document").toHaveLength(0);
  });
});
