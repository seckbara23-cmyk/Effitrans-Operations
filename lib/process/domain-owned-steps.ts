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

/**
 * WHERE the proof that the governed act happened actually lives
 * (UAT-CUSTOMS-SINGLE-DOOR-01).
 *
 * The first three entries in this map are billing steps, and the guard was
 * written to read the `invoice` table because that was the only domain it had.
 * `transit_validation` is governed by a CUSTOMS fact, and bolting customs onto
 * invoice semantics would have been the wrong shape twice over: the guard would
 * load rows it cannot use, and `domainFactSatisfied`'s « no invoice, no proof »
 * rule would refuse a customs dossier for having no invoice — which is the
 * normal state of every dossier at step 7.
 *
 * So each entry NAMES its source, the guard loads exactly that, and the rule is
 * asked with facts of the matching kind. A step whose declared source and
 * supplied facts disagree proves nothing and is refused.
 */
export type DomainFactSource = "invoice" | "customs_record";

export type DomainOwnedStep = {
  stepKey: string;
  /** The generic transitions withdrawn from this step. */
  withdraws: readonly GenericTransition[];
  /** The authoritative record carrying this step's unforgeable fact. */
  factSource: DomainFactSource;
  /**
   * What the operator must do instead, named as the product names it. Never a
   * function name: the sentence is read by someone looking for a button.
   */
  reasonFr: string;
};

/**
 * The ratified map. Four entries, and adding a fifth is a governance act: it
 * removes a control operators currently have.
 */
export const DOMAIN_OWNED_STEPS: Readonly<Record<string, DomainOwnedStep>> = {
  // Step 20 — closed by `submitInvoiceToFinance`, which refuses an invoice with
  // no lines and records the maker on the INVOICE before moving the step.
  billing_draft: {
    stepKey: "billing_draft",
    withdraws: ["submit"],
    factSource: "invoice",
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
    factSource: "invoice",
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
    factSource: "invoice",
    reasonFr:
      "Cette étape se termine en émettant la facture et en l'envoyant au client, depuis la facture du dossier.",
  },
  // Step 7 — closed by `validateCustoms`, which certifies the customs record
  // (`record_customs_validation` writes `reviewed_by` and `reviewed_at` in ONE
  // update) and only then calls `approveStep("transit_validation")`
  // (UAT-CUSTOMS-SINGLE-DOOR-01, ratified 2026-10-06).
  //
  // WHY IT WAS ADDED. `validateCustoms` has always been the single business
  // door and says so in its own comment — certify, then move the pair. But the
  // generic « Valider » stayed independently reachable, and on
  // EFT-IMP-2026-00014 the Chef de Transit used it: steps 6 and 7 completed
  // while `customs_record.reviewed_at` stayed NULL. That is not merely an
  // uncertified record. The controls `customs.update`, `customs.status` and
  // `customs.receivability` are all owned by step 6, so closing it stranded the
  // certification permanently AND froze the customs status at
  // DECLARATION_PREPARED, from which RELEASED is unreachable — taking steps
  // 15-26 with it. The mirror image of UAT-WF-STEP67-01, which fixed the same
  // pair when only the RECORD half went through.
  //
  // ONLY `approve` IS WITHDRAWN. There is no `rejectCustoms` domain action, so
  // withdrawing `reject` would leave the Chef unable to refuse a bad
  // declaration at all. The generic rejection path keeps its own governance —
  // the engine demands the motif and honours the pair's `correctionStep`.
  transit_validation: {
    stepKey: "transit_validation",
    withdraws: ["approve"],
    factSource: "customs_record",
    reasonFr:
      "La validation du dossier de dédouanement se fait sur le dossier douanier lui-même : « Valider — Chef de Transit ».",
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
 * The CUSTOMS fact the guard reads for `transit_validation`.
 *
 * Two columns, no name and no content: whether the record was certified, and by
 * whom. Written together by `record_customs_validation` in ONE update, so the
 * pair is atomic and the guard may require both.
 */
export type DomainCustomsFact = {
  reviewedAt: string | null;
  reviewedBy: string | null;
};

/**
 * The facts of ONE domain, tagged with which domain they came from.
 *
 * A discriminated union rather than a bag of optional fields, so a customs step
 * cannot be asked about invoices or the reverse — the compiler refuses it, and
 * `domainFactSatisfied` refuses it again at runtime for callers that are not
 * type-checked.
 */
export type DomainFacts =
  | { source: "invoice"; invoices: readonly DomainInvoiceFact[] }
  | { source: "customs_record"; customs: DomainCustomsFact | null };

/**
 * Has the governed act this transition represents ACTUALLY happened?
 *
 * PURE, so the rule that decides whether a step may close can be exercised
 * without a database — the server half only loads the rows and asks.
 *
 * Each domain action writes its fact BEFORE it calls the engine, so only the
 * governed action can make any of these answers true. That is what makes the
 * domain record a capability a caller cannot forge, where a parameter —
 * `{ viaDomainAction: true }` — would have been no boundary at all.
 *
 * FAILS CLOSED in four distinct ways, each of which has to be true for the
 * answer to be yes: the step must be in the map, the facts must come from the
 * source that step declares, the source must have produced a record, and that
 * record must carry the act.
 */
export function domainFactSatisfied(
  stepKey: string,
  transition: GenericTransition,
  facts: DomainFacts,
): boolean {
  const owned = domainOwnedStep(stepKey);
  // Not withdrawn at all: the guard never asks, and silence is not permission.
  if (!owned) return false;
  // EVIDENCE FROM THE WRONG DOMAIN PROVES NOTHING. A customs certification does
  // not close a billing step and an issued invoice does not certify a
  // declaration, so a mismatch is refused rather than reinterpreted.
  if (owned.factSource !== facts.source) return false;

  return facts.source === "invoice"
    ? invoiceFactSatisfied(stepKey, transition, facts.invoices)
    : customsFactSatisfied(stepKey, transition, facts.customs);
}

/**
 * The CUSTOMS rule (UAT-CUSTOMS-SINGLE-DOOR-01).
 *
 * `reviewed_at` is the authoritative instant, and the RPC says why in its own
 * words: « A legacy row carrying a bare `reviewed_by` was never validated in
 * this platform's sense, so it remains validatable. » So `reviewed_by` alone is
 * NOT certification — the old `record_customs_release` used to write it on its
 * own, which is what ATTR-CUSTOMS-01 stopped.
 *
 * BOTH are required anyway, and that is a tightening with no false refusal:
 * every writer of `reviewed_at` in the repository sets `reviewed_by` in the
 * SAME update statement, so a certified record always carries both. A row with
 * an instant and no author is a shape no code path can produce, and refusing it
 * costs nothing.
 */
function customsFactSatisfied(
  stepKey: string,
  transition: GenericTransition,
  customs: DomainCustomsFact | null,
): boolean {
  // No customs record, no proof — the dossier has evidently not been certified.
  if (!customs) return false;

  switch (stepKey) {
    case "transit_validation":
      // Only `approve` is withdrawn, so only `approve` has a rule here. A
      // rejection keeps the generic governed path: the engine demands the motif
      // and honours the pair's correction step, and no `rejectCustoms` exists
      // for it to be a way around.
      return (
        transition === "approve"
        && customs.reviewedAt !== null
        && customs.reviewedBy !== null
      );
  }

  // A customs-owned step the map withdraws but nobody gave a rule: refuse.
  return false;
}

/**
 * The INVOICE rule, unchanged in behaviour (BILLING-BYPASS-01,
 * STEP22-ISSUANCE-INTEGRITY-01). Only its reachability moved: it is now asked
 * solely for steps that declare `factSource: "invoice"`, which is why the empty
 * set below can keep meaning « no invoice, no act » without that refusing a
 * customs dossier for having no invoice.
 */
function invoiceFactSatisfied(
  stepKey: string,
  transition: GenericTransition,
  invoices: readonly DomainInvoiceFact[],
): boolean {
  // FAILS CLOSED on an empty set: a dossier with no invoice has evidently not
  // submitted, validated or rejected one.
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

  // An invoice-owned step the map withdraws but nobody gave a rule: refuse. The
  // guard only reaches here for a withdrawn step, and silence is not permission.
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
