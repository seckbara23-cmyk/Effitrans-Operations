/**
 * Contrôle Qualité N°6 — Facturation. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité » lists five controls for
 * Facturation. This module reports what the Finance authority already records.
 * Finance performs the operation; QC6 observes it and creates no invoice,
 * charge, approval, payment or archive fact of its own.
 *
 * WHAT THE CENSUS SETTLED, AND WHAT IT DID NOT.
 *
 * VALIDATION IS REAL. `invoice.status` carries an explicit `VALIDATED` state
 * between DRAFT and ISSUED, so « Validation de la facture » is an authoritative
 * fact rather than an inference from an invoice merely existing.
 *
 * VERIFICATION OF CHARGES IS NOT. `billing_charge` records what will be billed
 * — description, quantity, unit amount, tax rate — and carries NO status,
 * reviewer or verification timestamp. So the charges are countable and their
 * having been *checked* is not a fact the platform holds.
 *
 * ARCHIVING IS NOT. `operational_file.archived_at` exists but is documented in
 * its own migration as "reserved (ARCHIVED deferred to POD module)" — a column
 * awaiting a feature, not a working authority. Issued ≠ paid ≠ closed ≠
 * archived, and none of those may stand in for it.
 *
 * « DOSSIER COMPLET » AND « RESPECT PROCÉDURE » HAVE NO CRITERION. Neither a
 * finance completeness rule nor a procedure référentiel exists, and inventing
 * either would be manufacturing the judgement Effitrans has not defined.
 */
import { formatTenantInstant } from "@/lib/operations/kpi/windows";
import type { InvoiceDetail, Charge } from "@/lib/finance/types";

export type QC6ControlState = "observed" | "absent" | "restricted" | "not_represented";

export type QC6Control = {
  key: string;
  labelFr: string;
  state: QC6ControlState;
  value: string | null;
  reason?: string;
};

export const QC6_NO_CHARGE_VERIFICATION =
  "Aucune vérification distincte n'est enregistrée : la ligne de frais ne porte ni statut, ni relecteur, ni date de contrôle.";

export const QC6_NO_ARCHIVE_AUTHORITY =
  "Non représenté : aucun fait d'archivage n'est enregistré. Facturé, payé et clôturé sont des états distincts et ne valent pas archivage.";

export const QC6_NO_COMPLETENESS_CRITERION =
  "Non évalué : aucun critère ratifié ne définit un « dossier complet » côté facturation.";

export const QC6_NO_PROCEDURE_CRITERIA =
  "Non évalué : aucun référentiel de procédures n'est défini pour ce contrôle.";

export const RESTRICTED_FINANCE = "Non visible avec vos accès (finance).";

/**
 * Statuses at or beyond VALIDATED.
 *
 * Ordered by the invoice lifecycle, not alphabetically: an ISSUED or PAID
 * invoice was necessarily validated first, so treating only the literal
 * `VALIDATED` as evidence would report a paid invoice as unvalidated. VOID is
 * excluded — a cancelled invoice proves nothing about the dossier's billing.
 */
const VALIDATED_OR_BEYOND = ["VALIDATED", "ISSUED", "PARTIALLY_PAID", "PAID"] as const;

export function isValidated(status: string): boolean {
  return (VALIDATED_OR_BEYOND as readonly string[]).includes(status);
}

/** The invoice QC6 speaks about: the first one that reached validation. */
export function validatedInvoice(invoices: readonly InvoiceDetail[]): InvoiceDetail | null {
  const validated = invoices.filter((i) => isValidated(i.status));
  if (validated.length === 0) return null;
  return validated.reduce((earliest, i) =>
    (i.issueDate ?? "9999") < (earliest.issueDate ?? "9999") ? i : earliest,
  );
}

export type QC6Input = {
  canReadFinance: boolean;
  charges: readonly Charge[];
  invoices: readonly InvoiceDetail[];
  timeZone: string;
};

export type QC6Evidence = { controls: QC6Control[]; chargeCount: number | null };

const STATUS_FR: Record<string, string> = {
  DRAFT: "brouillon",
  VALIDATED: "validée",
  ISSUED: "émise",
  PARTIALLY_PAID: "partiellement réglée",
  PAID: "réglée",
  VOID: "annulée",
};

export function deriveQC6(input: QC6Input): QC6Evidence {
  // Gate FIRST: no finance:read means no finance fact is examined at all.
  const ok = input.canReadFinance;
  const charges = ok ? input.charges : null;
  const invoices = ok ? input.invoices : [];
  const validated = ok ? validatedInvoice(invoices) : null;
  const anyInvoice = invoices.length > 0;

  const controls: QC6Control[] = [
    {
      key: "chargeVerification",
      labelFr: "Vérification des frais",
      // The COUNT is a fact. Their verification is not.
      state: !ok ? "restricted" : charges!.length === 0 ? "absent" : "observed",
      value: charges && charges.length > 0
        ? `${charges.length} ligne${charges.length > 1 ? "s" : ""} de frais enregistrée${charges.length > 1 ? "s" : ""}`
        : null,
      reason: !ok ? RESTRICTED_FINANCE : QC6_NO_CHARGE_VERIFICATION,
    },
    {
      key: "invoiceValidation",
      labelFr: "Validation de la facture",
      state: !ok ? "restricted" : validated ? "observed" : "absent",
      value: validated
        ? `${validated.invoiceNumber ?? "Facture"} — ${STATUS_FR[validated.status] ?? validated.status}${
            validated.issueDate ? ` le ${formatTenantInstant(validated.issueDate, input.timeZone)}` : ""
          }`
        : null,
      reason: !ok
        ? RESTRICTED_FINANCE
        : validated
          ? undefined
          : anyInvoice
            ? "Une facture existe mais n'a pas atteint l'état « validée »."
            : undefined,
    },
    {
      key: "archiving",
      labelFr: "Archivage",
      state: !ok ? "restricted" : "not_represented",
      value: null,
      reason: !ok ? RESTRICTED_FINANCE : QC6_NO_ARCHIVE_AUTHORITY,
    },
    {
      key: "dossierComplete",
      labelFr: "Dossier complet",
      state: "not_represented",
      value: null,
      reason: QC6_NO_COMPLETENESS_CRITERION,
    },
    {
      key: "procedures",
      labelFr: "Respect procédure",
      state: "not_represented",
      value: null,
      reason: QC6_NO_PROCEDURE_CRITERIA,
    },
  ];

  return { controls, chargeCount: charges?.length ?? null };
}
