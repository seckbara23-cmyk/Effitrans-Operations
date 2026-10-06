import "server-only";
/**
 * The AUTHORITATIVE half of BILLING-BYPASS-01. SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * WHY THE UI IS NOT ENOUGH, PROVEN RATHER THAN ASSUMED. `engine/actions.ts`
 * carries the `"use server"` directive, so `submitStep`, `approveStep` and
 * `rejectStep` are not internal helpers — they are client-reachable server
 * action endpoints. Withdrawing their buttons hides them; it does not close
 * them. Anything reachable from a browser has to be refused on the server.
 *
 * A PARAMETER WOULD NOT HAVE WORKED EITHER. The obvious shape — pass
 * `{ viaDomainAction: true }` from the billing action — is not a boundary at
 * all: arguments to a server action come from the caller, so a crafted request
 * sets the flag as easily as the domain action does. A capability has to be
 * something the client cannot produce.
 *
 * SO THE GUARD ASKS FOR THE FACT, NOT FOR A TOKEN.
 *
 * Each domain action writes its invoice fact BEFORE it moves the step —
 * `submitInvoiceToFinance` stamps `submitted_at` (CAS on an unsubmitted DRAFT),
 * `approveInvoice` sets `VALIDATED`, `rejectInvoice` clears `submitted_at` and
 * records the motif — and only then calls the engine. So "has the governed act
 * actually happened?" is answerable from the invoice itself, and only the
 * governed action can make the answer yes. A generic call arrives before any
 * such fact exists and is refused; the domain action arrives after it and
 * passes, with nothing to wrap and no context to thread.
 *
 * This is the same shape that already protects step 22, whose `FINAL_INVOICE`
 * evidence requires an invoice that has left DRAFT. Steps 20 and 21 could not
 * use evidence for it — a draft carrying lines is not a document — so the
 * invariant is stated in `domainFactSatisfied` instead. NO requirement was
 * reclassified to achieve it.
 *
 * THIS FILE DECIDES NOTHING. It loads four columns and asks the pure rule, so
 * the rule is exercisable without a database and a mutation to it fails a test
 * rather than passing silently.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  domainFactSatisfied,
  domainOwnedStep,
  type DomainFacts,
  type DomainInvoiceFact,
  type GenericTransition,
} from "../domain-owned-steps";

type Row = Record<string, unknown>;

/**
 * May this GENERIC transition proceed on this step?
 *
 * True for every step the ratified map does not name — the overwhelming
 * majority — so this costs nothing outside the four governed steps and can
 * never change an unrelated refusal.
 *
 * THE SOURCE IS READ FROM THE MAP, NOT ASSUMED (UAT-CUSTOMS-SINGLE-DOOR-01).
 * This loaded `invoice` unconditionally, which was right while every entry was
 * a billing step. `transit_validation` is certified on the CUSTOMS record, and
 * loading invoices for it would have fed the invoice rule an empty set and
 * refused the only legitimate door — `validateCustoms`'s own internal
 * `approveStep` — on every dossier. So each entry declares its `factSource` and
 * this function loads exactly that one.
 */
export async function genericTransitionAllowed(input: {
  tenantId: string;
  fileId: string;
  stepKey: string;
  transition: GenericTransition;
}): Promise<boolean> {
  const owned = domainOwnedStep(input.stepKey);
  if (!owned || !owned.withdraws.includes(input.transition)) return true;

  const admin = getAdminSupabaseClient();

  if (owned.factSource === "customs_record") {
    const { data, error } = await admin
      .from("customs_record")
      .select("reviewed_at, reviewed_by")
      .eq("tenant_id", input.tenantId)
      .eq("file_id", input.fileId)
      .is("deleted_at", null)
      .maybeSingle();

    // FAIL CLOSED, as below: a read that did not answer is not permission.
    if (error) return false;

    const row = (data ?? null) as Row | null;
    const facts: DomainFacts = {
      source: "customs_record",
      customs: row
        ? {
            reviewedAt: (row.reviewed_at as string | null) ?? null,
            reviewedBy: (row.reviewed_by as string | null) ?? null,
          }
        : null,
    };
    return domainFactSatisfied(input.stepKey, input.transition, facts);
  }

  const { data, error } = await admin
    .from("invoice")
    .select("status, submitted_at, validated_at, rejection_reason, invoice_number")
    .eq("tenant_id", input.tenantId)
    .eq("file_id", input.fileId);

  // FAIL CLOSED. A read that did not answer is not permission to proceed on a
  // step whose whole point is that something must have happened first.
  if (error) return false;

  const invoices: DomainInvoiceFact[] = ((data ?? []) as Row[]).map((i) => ({
    status: String(i.status ?? ""),
    submittedAt: (i.submitted_at as string | null) ?? null,
    validatedAt: (i.validated_at as string | null) ?? null,
    rejectionReason: (i.rejection_reason as string | null) ?? null,
    invoiceNumber: (i.invoice_number as string | null) ?? null,
  }));

  return domainFactSatisfied(input.stepKey, input.transition, { source: "invoice", invoices });
}
