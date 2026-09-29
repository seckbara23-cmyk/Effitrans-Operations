/**
 * Steps whose transitions are owned by a DOMAIN workflow (BILLING-BYPASS-01).
 * PURE — client + server safe.
 * ---------------------------------------------------------------------------
 * Most official steps are closed by the generic engine controls: an operator
 * presses Démarrer, then Terminer, and `submitStep` records the act. A few are
 * not. Steps 20 and 21 carry business rules that live in `lib/process/billing`
 * — an invoice must have lines before it can be submitted, the checker must
 * differ from the person who drafted the INVOICE, a rejection must carry a
 * motif and reopen the draft with a new revision — and none of that is
 * expressible as step evidence.
 *
 * THE BYPASS THIS CLOSES. `billing_draft` declares `requiredDocuments: []`, so
 * `evaluateStepEvidence` returns nothing to block on and the generic
 * « Terminer » moved step 20 to SUBMITTED **with no invoice in existence**.
 * `approveStep` checks no invoice state at all, so the generic « Valider »
 * then completed steps 20 AND 21 and promoted step 22 — leaving an audit trail
 * asserting that Finance had validated a document that did not exist. Only step
 * 22 was protected, by its `FINAL_INVOICE` evidence.
 *
 * The generic approval became reachable for this pair in STEP18-COMPLETENESS-02,
 * which added Valider/Rejeter to the dossier for EVERY maker/checker pair. That
 * is right for `completeness_review`, which has no domain action and where the
 * generic controls ARE the act. It is wrong here, where they are a way around
 * one.
 *
 * WHAT THIS IS NOT. It is not a second billing state machine, and it does not
 * reclassify any requirement: `requiredDocuments` is untouched, the leniency
 * doctrine is untouched, and no requirement became a blocker. It withdraws two
 * GENERIC CONTROLS from two steps and names the action that replaces each one.
 * Every other step keeps every control it has.
 */

/** Which generic engine transition a domain workflow has taken over. */
export type GenericTransition = "submit" | "approve" | "reject";

export type DomainOwnedStep = {
  stepKey: string;
  /** The generic transitions withdrawn from this step. */
  withdraws: readonly GenericTransition[];
  /**
   * What the operator must do instead, named as the product names it. Never a
   * function name: the sentence is read by someone looking for a button.
   */
  reasonFr: string;
};

/**
 * The ratified map. Two entries, and adding a third is a governance act: it
 * removes a control operators currently have.
 */
export const DOMAIN_OWNED_STEPS: Readonly<Record<string, DomainOwnedStep>> = {
  // Step 20 — closed by `submitInvoiceToFinance`, which refuses an invoice with
  // no lines and records the maker on the INVOICE before moving the step.
  billing_draft: {
    stepKey: "billing_draft",
    withdraws: ["submit"],
    reasonFr:
      "Cette étape se termine en soumettant la facture à la Finance, depuis la facture du dossier.",
  },
  // Step 21 — closed by `approveInvoice` / `rejectInvoice`, which enforce
  // maker ≠ checker on the INVOICE's own author and, on a rejection, the motif
  // and the new revision. Note the generic review is offered on the SUBMITTED
  // PREPARER row (step 20); it is the VALIDATOR key that is named here.
  finance_invoice_validation: {
    stepKey: "finance_invoice_validation",
    withdraws: ["approve", "reject"],
    reasonFr:
      "Le contrôle de la facture se fait sur la facture elle-même : validation ou rejet motivé par la Finance.",
  },
  // Step 22 — closed by `emailValidatedInvoice`, which allocates the official
  // number, writes ISSUED, produces the official document and records the
  // outbound message before it moves the step (STEP22-ISSUANCE-INTEGRITY-01).
  //
  // WHY IT WAS ADDED. This step was thought to be protected already, by its
  // `FINAL_INVOICE` HARD_GATE. The gate was real; its predicate accepted any
  // invoice that was not a DRAFT, so a VALIDATED one satisfied it and the
  // generic « Terminer » closed step 22 on EFT-IMP-2026-00013 with no number,
  // no document and a failed email. The predicate is fixed too — this entry is
  // the second line, so neither alone has to be perfect.
  billing_dispatch: {
    stepKey: "billing_dispatch",
    withdraws: ["submit"],
    reasonFr:
      "Cette étape se termine en émettant la facture et en l'envoyant au client, depuis la facture du dossier.",
  },
};

export function domainOwnedStep(stepKey: string): DomainOwnedStep | null {
  return DOMAIN_OWNED_STEPS[stepKey] ?? null;
}

/**
 * The invoice facts the guard reads. Exactly the four columns each domain
 * action writes before it moves the step — nothing that could identify a
 * person, and no amount.
 */
export type DomainInvoiceFact = {
  status: string;
  submittedAt: string | null;
  validatedAt: string | null;
  rejectionReason: string | null;
  /**
   * The OFFICIAL number. Step 22's act is issuance, and an issued invoice
   * without one is not a fact this platform can produce — so the number is
   * what makes that act unforgeable by a generic caller.
   */
  invoiceNumber: string | null;
};

/** Statuses that prove the invoice is past drafting, by whatever route. */
const PAST_DRAFT = ["VALIDATED", "ISSUED", "PARTIALLY_PAID", "PAID"];

/** Statuses that prove the invoice was actually ISSUED. VALIDATED is not one. */
const ISSUED = ["ISSUED", "PARTIALLY_PAID", "PAID"];

/**
 * Has the governed act this transition represents ACTUALLY happened?
 *
 * PURE, so the rule that decides whether a step may close can be exercised
 * without a database — the server half only loads the rows and asks.
 *
 * Each domain action writes its invoice fact BEFORE it calls the engine, so
 * only the governed action can make any of these answers true. That is what
 * makes the invoice state a capability a caller cannot forge, where a
 * parameter — `{ viaDomainAction: true }` — would have been no boundary at all.
 *
 * FAILS CLOSED on an empty set: a dossier with no invoice has evidently not
 * submitted, validated or rejected one.
 */
export function domainFactSatisfied(
  stepKey: string,
  transition: GenericTransition,
  invoices: readonly DomainInvoiceFact[],
): boolean {
  if (invoices.length === 0) return false;
  const pastDraft = invoices.some((i) => PAST_DRAFT.includes(i.status));

  // KEYED ON THE STEP, not on the transition alone (STEP22-ISSUANCE-INTEGRITY-01).
  // Steps 20 and 22 both close with a `submit`, and their facts are different
  // things: "the draft was sent to Finance" and "the invoice was issued". Asking
  // the transition alone would have let step 20's submission mark admit step
  // 22's completion — the bypass this slice exists to close, reintroduced.
  switch (stepKey) {
    // Step 20 closes only once an invoice was actually SUBMITTED to Finance.
    // A legacy invoice that reached VALIDATED/ISSUED by another route has
    // evidently passed this act too, and must not be stranded.
    case "billing_draft":
      return pastDraft || invoices.some((i) => i.submittedAt !== null);

    case "finance_invoice_validation":
      // Step 21's approval closes only once `approveInvoice` wrote VALIDATED;
      // a rejection only once `rejectInvoice` reopened the draft with its motif.
      return transition === "approve"
        ? pastDraft
        : invoices.some((i) => i.rejectionReason !== null && i.submittedAt === null);

    // Step 22 closes only on ISSUANCE: an official number persisted together
    // with an issued status. Only `emailValidatedInvoice` writes that pair, in
    // one compare-and-set, so a generic caller cannot manufacture it.
    case "billing_dispatch":
      return invoices.some((i) => ISSUED.includes(i.status) && i.invoiceNumber !== null);
  }

  // A step the map withdraws but nobody gave a rule: refuse. The guard only
  // reaches here for a withdrawn step, and silence is not permission.
  return false;
}

/** Is this generic transition withdrawn from this step? */
export function isGenericTransitionWithdrawn(
  stepKey: string,
  transition: GenericTransition,
): boolean {
  return domainOwnedStep(stepKey)?.withdraws.includes(transition) ?? false;
}

/** The sentence to show instead of a button, or null for an ordinary step. */
export function domainOwnedReasonFr(stepKey: string): string | null {
  return domainOwnedStep(stepKey)?.reasonFr ?? null;
}
