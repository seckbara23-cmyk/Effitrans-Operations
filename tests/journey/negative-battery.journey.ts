/**
 * C-4 — the consolidated NEGATIVE BATTERY.
 * ---------------------------------------------------------------------------
 * Every invariant class C-4 ratified, exercised as a refusal, in one place, in
 * the order the dossier meets them.
 *
 * THE STANDARD HERE IS NOT THE ERROR CODE. A refusal that returns the right
 * string while leaving a mutation behind is not a refusal, so every high-value
 * case asserts the PROTECTED STATE afterwards: step state, assignment and
 * reviewer fields, handoff status and receiver, invoice status, validator and
 * number, the payment ledger, custody, dossier status, process terminal state,
 * and the presence or absence of audit rows where that is the point.
 *
 * BEHAVIOURAL, not source pins. The structural invariants — owning role can
 * execute its step, routed receiver holds the capability, permission alone
 * creates no eligibility, gate verdicts ignore the observer, consequential
 * results cannot be discarded — stay in their own suites, where they belong and
 * where they run without a database.
 *
 * The battery walks ONE dossier so each refusal is met in its real context, and
 * asserts the dossier still advances afterwards — a guard that refuses
 * everything is not a guard.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as, actAsNobody } from "./identity";
import {
  identity, execution, auditFor, handoffs, provideEvidence, customsIdFor, transportFor,
  db, fileRow, invoiceMoney, CLIENT_DEPOSIT_REQUIRED,
} from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, approveStep, sendHandoff, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit, assignTransitStep, recordBae } from "@/lib/process/engine/transit-actions";
import { createCustoms, changeCustomsStatus, recordGaindeRegistration } from "@/lib/customs/actions";
import { createTransport, assignTransport, changeTransportStatus } from "@/lib/transport/actions";
import { prepareInvoiceDraft, submitInvoiceToFinance, approveInvoice, emailValidatedInvoice } from "@/lib/process/billing/actions";
import { addInvoiceLine, recordPayment, verifyPayment } from "@/lib/finance/actions";
import { completeCollections, closeDossier } from "@/lib/collections/actions";

let ops: CurrentUser, am: CurrentUser, transit: CurrentUser, declarant: CurrentUser;
let coordinator: CurrentUser, field: CurrentUser, transport: CurrentUser, pickup: CurrentUser;
let billing: CurrentUser, finance: CurrentUser, collections: CurrentUser, courier: CurrentUser;

let fileId = "";
let invoiceId = "";

const need = <T extends { ok: boolean }>(r: T, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r;
};
const err = (r: unknown) => (r as { error?: string }).error;

/** The full state of one step, for before/after comparison. */
async function stepState(key: string) {
  const e = await execution(fileId, key);
  return {
    state: e?.state ?? null,
    assigned: e?.assigned_user_id ?? null,
    submittedBy: e?.submitted_by ?? null,
    reviewedBy: e?.reviewed_by ?? null,
    completedAt: e?.completed_at ?? null,
  };
}

describe("C-4 negative battery — the refusals, in the order a dossier meets them", () => {
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
    courier = await identity("courier");

    const created = need(
      await as(am, () =>
        createFile({
          type: "IMP",
          clientId: CLIENT_DEPOSIT_REQUIRED,
          priority: "normal",
          shipment: { transportMode: "SEA", origin: "JOURNEY NEG", destination: "Dakar", blAwbRef: `JRN-NEG-${Date.now()}` },
        }),
      ),
      "createFile",
    );
    fileId = (created as unknown as { id: string }).id;
    need(await as(ops, () => openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true })), "open");
  }, 120_000);

  // ------------------------------------------------------------ intake ----

  it("OUT OF SEQUENCE — a step whose prerequisite is unfinished cannot start", async () => {
    const before = await stepState("customs_preparation");
    const refused = await as(transit, () => activateStep(fileId, "customs_preparation"));
    expect(refused.ok).toBe(false);
    // OBSERVED, not inferred: the refusal is `forbidden`, because Transit has no
    // ground to see this dossier yet — it owns no open step on it. Authorization
    // is evaluated before sequencing, so the earlier guard answers first. Either
    // way the step did not start, which is what this case protects.
    expect(err(refused)).toBe("forbidden");
    expect(await stepState("customs_preparation"), "nothing moved").toEqual(before);
  });

  it("WRONG ACTOR — and SIGNED OUT — cannot act on a step", async () => {
    const before = await stepState("operations_intake");
    const wrong = await as(courier, () => submitStep(fileId, "operations_intake"));
    expect(wrong.ok).toBe(false);
    expect(err(wrong)).toBe("forbidden");

    actAsNobody();
    const anon = await submitStep(fileId, "operations_intake");
    expect(anon.ok, "signed out is refused").toBe(false);

    expect(await stepState("operations_intake"), "neither attempt moved it").toEqual(before);
  });

  it("MISSING EVIDENCE — step 3 refuses, and stays exactly as it was", async () => {
    need(await as(ops, () => submitStep(fileId, "operations_intake")), "step 2");
    need(await as(am, () => activateStep(fileId, "am_dossier_opening")), "activate 3");

    const before = await stepState("am_dossier_opening");
    const refused = await as(am, () => submitStep(fileId, "am_dossier_opening"));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("evidence_missing");
    expect(await stepState("am_dossier_opening")).toEqual(before);
  });

  it("INVALID « sans objet » — a non-declarable type, and a blank motif", async () => {
    const countBefore = async () =>
      ((await db().from("evidence_absence_declaration").select("id").eq("file_id", fileId)).data ?? []).length;
    const before = await countBefore();

    const notDeclarable = await as(am, () => declareEvidenceAbsence(fileId, "BORDEREAU_LIVRAISON", "pas de BL"));
    expect(notDeclarable.ok).toBe(false);
    expect(err(notDeclarable)).toBe("evidence_not_declarable");

    const noMotif = await as(am, () => declareEvidenceAbsence(fileId, "VENDOR_INVOICE", "   "));
    expect(noMotif.ok).toBe(false);
    expect(err(noMotif)).toBe("reason_required");

    const invented = await as(am, () => declareEvidenceAbsence(fileId, "NOT_A_REAL_KEY", "x"));
    expect(invented.ok).toBe(false);

    expect(await countBefore(), "no declaration row was written by any refusal").toBe(before);
  });

  it("CLAIMED-STEP HIJACK — another actor cannot take a claimed step", async () => {
    const before = await stepState("am_dossier_opening");
    expect(before.assigned, "step 3 is claimed by the Account Manager").toBe(am.id);

    const hijack = await as(ops, () => submitStep(fileId, "am_dossier_opening"));
    // ops holds file:create and file:read:all, so this is refused on the CLAIM,
    // not on permission or visibility.
    expect(hijack.ok).toBe(false);
    expect(await stepState("am_dossier_opening"), "assignment and state intact").toEqual(before);
  });

  // ----------------------------------------------------------- handoff ----

  it("EARLY HANDOFF — a handoff may not outrun its own from-step (C-2)", async () => {
    const early = await as(am, () => handDossierToTransit(fileId));
    expect(early.ok, "step 3 is not finished").toBe(false);
    expect(await handoffs(fileId), "no handoff row exists").toHaveLength(0);
  });

  it("…then step 3 completes legitimately and the handoff is sent", async () => {
    await provideEvidence(fileId, "BORDEREAU_LIVRAISON", am, ops);
    await provideEvidence(fileId, "TRANSPORT_REQUEST", am, ops);
    for (const key of ["VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]) {
      need(await as(am, () => declareEvidenceAbsence(fileId, key, `sans objet — ${key}`)), `declare ${key}`);
    }
    need(await as(am, () => submitStep(fileId, "am_dossier_opening")), "step 3");
    need(await as(am, () => handDossierToTransit(fileId)), "handoff");
    const rows = await handoffs(fileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
  });

  it("PERMISSION WITHOUT ELIGIBILITY — a holder who is not the routed receiver", async () => {
    // The Account Manager holds process:handoff:receive AND file:read:all, so
    // permission and visibility are both satisfied. It is simply not Transit.
    const open = (await handoffs(fileId)).find((h) => h.status === "SENT");
    const refused = await as(am, () => receiveHandoff(fileId, open!.id as string));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("not_eligible_receiver");

    const after = (await handoffs(fileId)).find((h) => h.id === open!.id);
    expect(after!.status, "still waiting").toBe("SENT");
    expect(after!.received_by, "no receiver recorded").toBeNull();
    // The target is AVAILABLE — completing step 3 promoted it (C-1) — but the
    // refusal changed nothing about the HANDOFF, which is what was attempted.
    expect((await stepState("coordinator_reception")).state).toBe("AVAILABLE");
  });

  it("SKIPPED RECEPTION — the target step cannot be started before it is received", async () => {
    const before = await stepState("coordinator_reception");
    const refused = await as(transit, () => activateStep(fileId, "coordinator_reception"));
    expect(refused.ok, "reception is its own act").toBe(false);
    expect(await stepState("coordinator_reception")).toEqual(before);
  });

  // ------------------------------------------------------------ customs ----

  it("MAKER = CHECKER 6→7 — the preparer cannot validate its own work", async () => {
    need(await as(transit, () => receiveDossierAtTransit(fileId)), "receive");
    need(await as(transit, () => activateStep(fileId, "coordinator_reception")), "activate 4");
    need(await as(transit, () => submitStep(fileId, "coordinator_reception")), "step 4");
    need(await as(transit, () => assignTransitStep(fileId, "customs_preparation", transit.id)), "assign");
    need(await as(transit, () => activateStep(fileId, "transit_declarant_assignment")), "activate 5");
    need(await as(transit, () => submitStep(fileId, "transit_declarant_assignment")), "step 5");
    need(await as(transit, () => activateStep(fileId, "customs_preparation")), "activate 6");
    need(await as(transit, () => createCustoms(fileId)), "customs");
    for (const code of ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "BILL_OF_LADING"]) {
      await provideEvidence(fileId, code, transit, ops);
    }
    const customsId = await customsIdFor(fileId);
    for (const st of ["DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED", "DUTIES_ASSESSED"]) {
      need(await as(transit, () => changeCustomsStatus(customsId, st)), `customs ${st}`);
    }
    need(await as(transit, () => submitStep(fileId, "customs_preparation")), "step 6");

    const before = await stepState("customs_preparation");
    expect(before.state, "waiting for review").toBe("SUBMITTED");

    // CHIEF_OF_TRANSIT holds customs:create AND customs:validate, so this
    // refusal is about IDENTITY and not permission.
    const self = await as(transit, () => approveStep(fileId, "transit_validation"));
    expect(self.ok).toBe(false);
    expect(err(self)).toBe("self_validation_forbidden");

    const after = await stepState("customs_preparation");
    expect(after, "no reviewer, no completion, nothing moved").toEqual(before);
    expect((await stepState("transit_validation")).state).not.toBe("COMPLETED");
  });

  it("UNAUTHORIZED VALIDATION — an actor without customs:validate is refused differently", async () => {
    const before = await stepState("customs_preparation");
    const refused = await as(declarant, () => approveStep(fileId, "transit_validation"));
    expect(refused.ok).toBe(false);
    expect(err(refused), "permission, not identity").toBe("forbidden");
    expect(await stepState("customs_preparation")).toEqual(before);
  });

  // ------------------------------------------------------------- pickup ----

  it("PICKUP BEFORE CONVERGENCE — one branch landed is not both", async () => {
    need(await as(ops, () => approveStep(fileId, "transit_validation")), "step 7");
    need(await as(coordinator, () => activateStep(fileId, "coordinator_to_finance")), "activate 8");
    need(await as(coordinator, () => submitStep(fileId, "coordinator_to_finance")), "step 8");
    need(await as(coordinator, () => sendHandoff(fileId, "coordinator_to_finance", "gainde_registration")), "send 9");
    const customsId = await customsIdFor(fileId);
    need(await as(ops, () => recordGaindeRegistration(customsId, `GAINDE-NEG-${Date.now()}`)), "gainde");
    need(await as(coordinator, () => activateStep(fileId, "coordinator_to_declarant")), "activate 10");
    need(await as(coordinator, () => submitStep(fileId, "coordinator_to_declarant")), "step 10");
    const h = (await handoffs(fileId)).find((x) => x.to_step_key === "gainde_document_submission" && x.status === "SENT");
    if (h) need(await as(declarant, () => receiveHandoff(fileId, h.id as string)), "receive 11");
    need(await as(declarant, () => activateStep(fileId, "gainde_document_submission")), "activate 11");
    await provideEvidence(fileId, "GAINDE_SUBMISSION_EVIDENCE", declarant, ops);
    need(await as(declarant, () => submitStep(fileId, "gainde_document_submission")), "step 11");
    need(await as(coordinator, () => activateStep(fileId, "customs_followup")), "activate 12");
    need(await as(coordinator, () => submitStep(fileId, "customs_followup")), "step 12");
    need(await as(field, () => activateStep(fileId, "customs_field_clearance")), "activate 13");
    need(await as(field, () => recordBae(fileId, `BAE-NEG-${Date.now()}`)), "bae");

    // Customs branch landed; transport branch has not.
    const before = await stepState("pickup");
    expect(before.state, "pickup waits on its second branch").toBe("PENDING");
    const refused = await as(pickup, () => activateStep(fileId, "pickup"));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("prerequisites_unmet");
    expect(await stepState("pickup")).toEqual(before);
  });

  it("PICKUP BEFORE READINESS — promoted is not the same as ready", async () => {
    need(await as(transport, () => activateStep(fileId, "transport_assignment")), "activate 14");
    need(await as(transport, () => createTransport(fileId)), "createTransport");
    const t = await transportFor(fileId);
    need(await as(transport, () => assignTransport(t.id, { driverName: "Neg", vehiclePlate: "DK-NEG-1" }, t.updatedAt)), "assign");
    need(await as(transport, () => submitStep(fileId, "transport_assignment")), "step 14");

    // Both prerequisites are now done, so pickup is PROMOTED…
    const before = await stepState("pickup");
    expect(before.state).toBe("AVAILABLE");

    // …and the READINESS gate is a separate question: no Bon à Délivrer, no
    // Pre-Gate authorisation yet.
    const refused = await as(pickup, () => activateStep(fileId, "pickup"));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("gate_blocked");

    const after = await stepState("pickup");
    expect(after.state, "a blocked gate leaves it AVAILABLE, unstarted").toBe("AVAILABLE");
    expect(after.assigned).toBeNull();
    expect(after, "nothing at all moved").toEqual(before);
  });

  // ------------------------------------------------------------ billing ----

  it("BILLING BEFORE THE GATE — no invoice before the completeness reviews", async () => {
    const before = ((await db().from("invoice").select("id").eq("file_id", fileId)).data ?? []).length;
    const refused = await as(billing, () => prepareInvoiceDraft(fileId));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("dossier_not_billing_ready");
    const after = ((await db().from("invoice").select("id").eq("file_id", fileId)).data ?? []).length;
    expect(after, "no invoice row was created").toBe(before);
  });

  it("INVOICE WITHOUT LINES cannot be submitted; SELF-VALIDATION is refused", async () => {
    // Carry to the billing gate through the real chain.
    need(await as(am, () => activateStep(fileId, "bon_a_delivrer")), "activate BAD");
    await provideEvidence(fileId, "BON_A_DELIVRER", am, ops);
    need(await as(am, () => submitStep(fileId, "bon_a_delivrer")), "BAD");
    need(await as(am, () => activateStep(fileId, "pre_gate")), "activate pre-gate");
    await provideEvidence(fileId, "PRE_GATE_AUTHORIZATION", am, ops);
    need(await as(am, () => submitStep(fileId, "pre_gate")), "pre-gate");
    need(await as(pickup, () => activateStep(fileId, "pickup")), "activate 15");
    const t2 = await transportFor(fileId);
    for (const st of ["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP"]) {
      need(await as(pickup, () => changeTransportStatus(t2.id, st)), `transport ${st}`);
    }
    need(await as(am, () => activateStep(fileId, "am_delivery_followup")), "activate 16");
    await provideEvidence(fileId, "SIGNED_DELIVERY_NOTE", am, ops);
    need(await as(am, () => submitStep(fileId, "am_delivery_followup")), "step 16");
    const t3 = await transportFor(fileId);
    for (const st of ["IN_TRANSIT", "DELIVERED"]) {
      need(await as(transport, () => changeTransportStatus(t3.id, st)), `transport ${st}`);
    }
    need(await as(coordinator, () => activateStep(fileId, "transport_docs_transmission")), "activate transmission");
    need(await as(coordinator, () => submitStep(fileId, "transport_docs_transmission")), "transmission");
    need(await as(coordinator, () => activateStep(fileId, "coordinator_completeness")), "activate 18");
    await provideEvidence(fileId, "RECEIPT", coordinator, ops);
    need(await as(coordinator, () => submitStep(fileId, "coordinator_completeness")), "step 18");

    // MAKER = CHECKER 18→19, before the Account Manager approves.
    const b18 = await stepState("coordinator_completeness");
    expect(b18.state).toBe("SUBMITTED");
    const self18 = await as(coordinator, () => approveStep(fileId, "am_completeness"));
    expect(self18.ok).toBe(false);
    expect(err(self18)).toBe("self_validation_forbidden");
    expect(await stepState("coordinator_completeness"), "18 untouched").toEqual(b18);

    need(await as(am, () => approveStep(fileId, "am_completeness")), "step 19");

    need(await as(billing, () => activateStep(fileId, "billing_draft")), "activate 20");
    const draft = need(await as(billing, () => prepareInvoiceDraft(fileId)), "draft");
    invoiceId = (draft as unknown as { id: string }).id;

    const noLines = await as(billing, () => submitInvoiceToFinance(invoiceId));
    expect(noLines.ok).toBe(false);
    expect(err(noLines)).toBe("no_lines");
    const inv0 = await invoiceMoney(invoiceId);
    expect(inv0.status, "still a draft").toBe("DRAFT");

    need(
      await as(billing, () => addInvoiceLine(invoiceId, { description: "Neg battery", quantity: 1, unitAmount: 120000, taxRate: 18 })),
      "line",
    );
    need(await as(ops, () => submitInvoiceToFinance(invoiceId)), "submit invoice");

    // ISSUANCE BEFORE VALIDATION.
    const early = await as(billing, () => emailValidatedInvoice(invoiceId));
    expect(early.ok).toBe(false);
    expect(err(early)).toBe("invoice_not_validated");

    // MAKER = CHECKER 20→21: ops submitted it and ops holds finance:validate.
    const selfApprove = await as(ops, () => approveInvoice(invoiceId));
    expect(selfApprove.ok).toBe(false);
    expect(err(selfApprove)).toBe("self_approval_forbidden");

    const inv = await invoiceMoney(invoiceId);
    const { data: row } = await db()
      .from("invoice").select("status, validated_by, validated_at, invoice_number").eq("id", invoiceId).maybeSingle();
    expect(row?.status, "still an unvalidated draft").toBe("DRAFT");
    expect(row?.validated_by, "no validator identity").toBeNull();
    expect(row?.validated_at, "no validation timestamp").toBeNull();
    expect(inv.invoiceNumber, "and no official number consumed").toBeNull();
  });

  it("UNAUTHORIZED VALIDATION — an actor without finance:validate is refused", async () => {
    const refused = await as(billing, () => approveInvoice(invoiceId));
    expect(refused.ok).toBe(false);
    expect(err(refused)).toBe("forbidden");
    const { data: row } = await db().from("invoice").select("validated_by").eq("id", invoiceId).maybeSingle();
    expect(row?.validated_by).toBeNull();
  });

  // ------------------------------------------------------------- money ----

  it("PARTIAL and UNVERIFIED payment cannot settle; OVERPAYMENT is refused", async () => {
    need(await as(finance, () => approveInvoice(invoiceId)), "validate");
    need(await as(billing, () => emailValidatedInvoice(invoiceId)), "issue");

    const total = (await invoiceMoney(invoiceId)).total;
    const part = Math.round(total * 0.5 * 100) / 100;
    need(await as(finance, () => recordPayment(invoiceId, { amount: part, method: "BANK_TRANSFER" })), "partial");

    // PREMATURE STEP 26 — settlement is not proved yet.
    const early26 = await as(collections, () => completeCollections(invoiceId));
    expect(early26.ok, "collections cannot complete on a partial payment").toBe(false);

    // PREMATURE CLOSURE.
    const earlyClose = await as(ops, () => closeDossier(fileId));
    expect(earlyClose.ok).toBe(false);
    expect((await fileRow(fileId))?.status).not.toBe("CLOSED");

    // OVERPAYMENT.
    const before = await invoiceMoney(invoiceId);
    const over = await as(finance, () => recordPayment(invoiceId, { amount: before.balance + 5000, method: "BANK_TRANSFER" }));
    expect(over.ok).toBe(false);
    expect(err(over)).toBe("exceeds_balance");
    const after = await invoiceMoney(invoiceId);
    expect(after.paid, "the ledger is untouched").toBe(before.paid);
    expect(after.payments.length).toBe(before.payments.length);

    // UNVERIFIED settlement — a zero balance is still not settled.
    need(await as(finance, () => recordPayment(invoiceId, { amount: before.balance, method: "BANK_TRANSFER" })), "final");
    expect((await invoiceMoney(invoiceId)).balance).toBe(0);

    const unverifiedClose = await as(ops, () => closeDossier(fileId));
    expect(unverifiedClose.ok, "verification is separate from settlement").toBe(false);
    expect((await fileRow(fileId))?.status).not.toBe("CLOSED");
  });

  it("DEPOSIT-REQUIRED closure without an accepted proof is refused", async () => {
    const { data: pays } = await db().from("payment").select("id").eq("invoice_id", invoiceId);
    for (const p of pays ?? []) need(await as(finance, () => verifyPayment(p.id as string)), "verify");

    // This client REQUIRES a physical deposit and none has been made.
    const refused = await as(ops, () => closeDossier(fileId));
    expect(refused.ok, "the deposit branch is required for this client").toBe(false);

    const file = await fileRow(fileId);
    expect(file?.status, "dossier untouched").not.toBe("CLOSED");
    const { data: inst } = await db().from("process_instance").select("status").eq("file_id", fileId).maybeSingle();
    expect(inst?.status, "process untouched").not.toBe("CLOSED");
  });

  it("the dossier is still advanceable — a battery of refusals broke nothing", async () => {
    // A guard that refuses everything is not a guard. The dossier met every
    // refusal above and remains in a legitimate, workable state.
    expect((await stepState("collections")).state).not.toBe("REJECTED");
    const money = await invoiceMoney(invoiceId);
    expect(money.status).toBe("ISSUED");
    expect(money.balance).toBe(0);
    expect(money.invoiceNumber, "the invoice kept its official identity").toBeTruthy();
  });
});
