/**
 * Department workspace classification (Phase 2.0) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Turns existing queue/status data into department dashboard-card counts and a
 * per-row "next action" (whose key also encodes the cross-department HAND-OFF
 * indicator, e.g. customs RELEASED -> "→ Transport"). No I/O, fully unit-tested.
 * Action helpers return a stable KEY (for tests) + a French label (for the UI),
 * keeping logic decoupled from copy.
 */
import type { CustomsStatus } from "@/lib/customs/types";
import type { TransportStatus } from "@/lib/transport/types";
import type { InvoiceStatus, DocDossierRow } from "./types";

export type NextAction = { key: string; label: string };

// ----------------------------------------------------------- Documentation ----

/** Per-dossier document summary from raw (typeCode,status) rows + required set. */
export function summarizeDossierDocs(
  docs: { typeCode: string; status: string }[],
  requiredCodes: string[],
): { pending: number; verified: number; missing: number } {
  const pending = docs.filter((d) => d.status === "UPLOADED" || d.status === "PENDING_REVIEW").length;
  const verified = docs.filter((d) => d.status === "APPROVED").length;
  const approved = new Set(docs.filter((d) => d.status === "APPROVED").map((d) => d.typeCode));
  const missing = requiredCodes.filter((c) => !approved.has(c)).length;
  return { pending, verified, missing };
}

export type DocumentationCards = { pending: number; missing: number; verified: number; urgent: number };

export function documentationCards(rows: DocDossierRow[]): DocumentationCards {
  const isUrgent = (p: string) => p === "high" || p === "critical";
  return {
    pending: rows.filter((r) => r.pending > 0).length,
    missing: rows.filter((r) => r.missing > 0).length,
    verified: rows.filter((r) => r.missing === 0 && r.pending === 0 && r.verified > 0).length,
    urgent: rows.filter((r) => isUrgent(r.priority) && (r.missing > 0 || r.pending > 0)).length,
  };
}

export function documentationNextAction(row: DocDossierRow): NextAction {
  if (row.missing > 0) return { key: "request_missing", label: "Demander les documents manquants" };
  if (row.pending > 0) return { key: "verify", label: "Vérifier les documents" };
  return { key: "to_customs", label: "Prêt → Douane" };
}

// ----------------------------------------------------------------- Customs ----

export type CustomsCards = {
  readyForDeclaration: number;
  awaitingResponse: number;
  underInspection: number;
  readyForRelease: number;
};

export function customsCards(rows: { status: CustomsStatus }[]): CustomsCards {
  const c = (set: CustomsStatus[]) => rows.filter((r) => set.includes(r.status)).length;
  return {
    readyForDeclaration: c(["NOT_STARTED", "DOCUMENTS_PENDING", "DECLARATION_PREPARED"]),
    awaitingResponse: c(["DECLARED", "UNDER_REVIEW"]),
    underInspection: c(["INSPECTION"]),
    readyForRelease: c(["DUTIES_ASSESSED"]),
  };
}

export function customsNextAction(status: CustomsStatus): NextAction {
  switch (status) {
    case "NOT_STARTED": return { key: "prepare_docs", label: "Préparer les documents" };
    case "DOCUMENTS_PENDING": return { key: "prepare_declaration", label: "Préparer la déclaration" };
    case "DECLARATION_PREPARED": return { key: "declare", label: "Déclarer" };
    case "DECLARED":
    case "UNDER_REVIEW": return { key: "await_response", label: "Suivre la réponse douane" };
    case "INSPECTION": return { key: "inspection", label: "Inspection en cours" };
    case "DUTIES_ASSESSED": return { key: "release", label: "Libérer (BAE)" };
    case "RELEASED": return { key: "to_transport", label: "Libéré → Transport" };
    case "BLOCKED": return { key: "unblock", label: "Débloquer" };
    case "CANCELLED": return { key: "cancelled", label: "Annulé" };
  }
}

// --------------------------------------------------------------- Transport ----

export type TransportCards = {
  readyForDispatch: number;
  assigned: number;
  inTransit: number;
  podRequired: number;
  delivered: number;
};

export function transportCards(rows: { status: TransportStatus }[]): TransportCards {
  const c = (set: TransportStatus[]) => rows.filter((r) => set.includes(r.status)).length;
  return {
    readyForDispatch: c(["NOT_STARTED", "PLANNED"]),
    assigned: c(["DRIVER_ASSIGNED"]),
    inTransit: c(["PICKED_UP", "IN_TRANSIT"]),
    podRequired: c(["DELIVERED"]),
    delivered: c(["POD_RECEIVED"]),
  };
}

export function transportNextAction(status: TransportStatus): NextAction {
  switch (status) {
    case "NOT_STARTED":
    case "PLANNED": return { key: "assign_driver", label: "Affecter chauffeur / véhicule" };
    case "DRIVER_ASSIGNED": return { key: "start_pickup", label: "Démarrer l'enlèvement" };
    case "PICKED_UP":
    case "IN_TRANSIT": return { key: "track", label: "Suivre le transport" };
    case "DELIVERED": return { key: "upload_pod", label: "Téléverser le POD" };
    case "POD_RECEIVED": return { key: "to_finance", label: "Livré → Finance" };
    case "BLOCKED": return { key: "unblock", label: "Débloquer" };
    case "CANCELLED": return { key: "cancelled", label: "Annulé" };
  }
}

// ----------------------------------------------------------------- Finance ----

export type FinanceCards = {
  invoicesPending: number;
  outstanding: number;
  overdue: number;
  paymentsToVerify: number;
  revenueMonth: number;
};

export function financeCards(
  invoices: { status: InvoiceStatus; balance: number; overdue: boolean }[],
  paymentsToVerify: number,
  revenueMonth: number,
): FinanceCards {
  const open = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
  return {
    invoicesPending: open.length,
    outstanding: open.reduce((s, i) => s + i.balance, 0),
    overdue: invoices.filter((i) => i.overdue).length,
    paymentsToVerify,
    revenueMonth,
  };
}

export function financeNextAction(status: InvoiceStatus): NextAction {
  switch (status) {
    case "DRAFT": return { key: "issue", label: "Émettre la facture" };
    // Phase 5.0D — validated by Finance (official step 21), awaiting dispatch.
    case "VALIDATED": return { key: "send", label: "Envoyer la facture au client" };
    case "ISSUED": return { key: "record_payment", label: "Enregistrer le paiement" };
    case "PARTIALLY_PAID": return { key: "record_balance", label: "Enregistrer le solde" };
    case "PAID": return { key: "to_archive", label: "Payée → Archivage" };
    case "VOID": return { key: "void", label: "Annulée" };
  }
}
