/**
 * C-4 — does a successful external send report success when the workflow
 * transition it was supposed to cause silently failed?
 * ---------------------------------------------------------------------------
 * `emailValidatedInvoice` ends with `await submitStep(fileId, "billing_dispatch")`
 * and DISCARDS the result. `submitStep` requires the step to be ACTIVE —
 * AVAILABLE → COMPLETED is not a legal transition — and the billing lane
 * contains no `assertControlStep`, so nothing forces step 22 to be claimed
 * before the invoice is emailed.
 *
 * This file does not assume that matters. It CONSTRUCTS the condition through
 * the governed path only — permission held, invoice genuinely VALIDATED, step 22
 * merely AVAILABLE — performs a REAL SMTP delivery, and then records exactly
 * what happened to the invoice, to the caller's result, and to steps 22 and 23.
 *
 * The invariant under test:
 *
 *   An action performing an irreversible external side effect must not report
 *   overall workflow success while a required consequential workflow transition
 *   has failed silently.
 *
 * If the governed path makes the condition impossible, that is the finding and
 * it is proved here too — the assertions below say what IS, either way.
 */
import { describe, it, expect, beforeAll } from "vitest";
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
  need(await as(ops, () => submitStep(fileId, "operations_intake")), "step 2");

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
  if (open2.length > 0) need(await as(transit, () => receiveHandoff(fileId, open2[0].id as string)), "receive 11");
  need(await as(transit, () => activateStep(fileId, "gainde_document_submission")), "activate 11");
  await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", transit, ops);
  need(await as(transit, () => submitStep(fileId, "gainde_document_submission")), "step 11");

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

    // …and nothing in the billing lane requires it to be claimed.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../lib/process/billing/actions.ts", import.meta.url), "utf8"),
    );
    expect(src, "the lane has no control-step gate").not.toContain("assertControlStep");
  });

  it("THE FINDING — the send succeeds, the invoice issues, the workflow does not, and the caller is told OK", async () => {
    const recipient = await billingRecipientFor(CLIENT_DEPOSIT_REQUIRED);
    const before = (await sinkMessagesFor(recipient)).length;

    // What submitStep WOULD return in this state — the value the action discards.
    const wouldBe = await as(billing, () => submitStep(fileId, "billing_dispatch"));
    expect(wouldBe.ok, "submitStep cannot complete an unclaimed step").toBe(false);
    expect((wouldBe as { error: string }).error).toBe("invalid_state");

    // Now the real thing.
    const sent = await as(billing, () => emailValidatedInvoice(invoiceId));

    // 1. The external side effect HAPPENED and is irreversible.
    const after = await sinkMessagesFor(recipient);
    expect(after.length, "the customer really was emailed").toBe(before + 1);

    // 2. The invoice is ISSUED — an official number has been consumed.
    const { data: inv } = await db()
      .from("invoice")
      .select("status, invoice_number, issued_by")
      .eq("id", invoiceId)
      .maybeSingle();
    expect(inv?.status).toBe("ISSUED");
    expect(inv?.invoice_number).toBeTruthy();

    // 3. The consequential workflow transition did NOT happen.
    const s22 = await execution(fileId, "billing_dispatch");
    expect(s22?.state, "step 22 did not advance").not.toBe("COMPLETED");

    // 4. …so the successor never opened, and the chain is stalled.
    expect((await execution(fileId, "administration_deposit_prep"))?.state).toBe("PENDING");

    // 5. And the caller was told it all worked.
    expect(sent.ok, "THE DEFECT: overall success reported despite a failed consequence").toBe(true);

    // 6. Nothing recorded that the consequence failed — no audit names it.
    const events = await auditFor("invoice.emailed", invoiceId);
    expect(events.length, "the send is audited").toBeGreaterThan(0);
    const stallAudit = await auditFor("process.step.blocked", invoiceId);
    expect(stallAudit, "and nothing at all records the stall").toHaveLength(0);
  });
});
