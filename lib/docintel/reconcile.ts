/**
 * Document Intelligence — cross-document reconciliation (Phase 7.4A). PURE.
 * Compares candidate values across the documents of ONE operational file (and against
 * operational records). Conflicts are SHOWN, never silently resolved. An authoritative source
 * is named only where a business rule defines one; otherwise a human decides.
 */
import { reconcileInvoiceTotals } from "./validate";

export type ReconStatus = "AGREEMENT" | "CONFLICT" | "MISSING";
export type ReconResult = { comparison: string; status: ReconStatus; a: string | null; b: string | null; authoritative: string | null; humanActionRequired: boolean };

function eqUpper(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}
function numClose(a: string | null, b: string | null, tol = 0.5): boolean {
  const x = a == null ? NaN : Number(a), y = b == null ? NaN : Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
}
function pair(comparison: string, a: string | null, b: string | null, kind: "text" | "number", authoritative: string | null = null): ReconResult {
  if (a == null || b == null) return { comparison, status: "MISSING", a, b, authoritative, humanActionRequired: false };
  const agree = kind === "number" ? numClose(a, b) : eqUpper(a, b);
  return { comparison, status: agree ? "AGREEMENT" : "CONFLICT", a, b, authoritative, humanActionRequired: !agree };
}

/** A flat map of normalized candidate values by class then field key (from a file's jobs). */
export type FileCandidateMap = Record<string, Record<string, string | null>>;
/** Current operational values that candidates are reconciled against (safe, optional). */
export type OperationalValues = { oceanMasterBl?: string | null; oceanContainer?: string | null; airMawb?: string | null; voyageEta?: string | null };

/** Build the defined cross-document + vs-operational checks. Only emits a check when at
 *  least one side is present; a missing counterpart yields MISSING (never a guess). */
export function crossDocumentChecks(byClass: FileCandidateMap, op: OperationalValues = {}): ReconResult[] {
  const g = (cls: string, key: string) => byClass[cls]?.[key] ?? null;
  const out: ReconResult[] = [];

  // Invoice vs packing-list gross weight.
  out.push(pair("invoice_vs_packing_gross_weight", g("COMMERCIAL_INVOICE", "gross_weight") ?? g("PACKING_LIST", "gross_weight"), g("PACKING_LIST", "gross_weight"), "number"));
  // BL container vs operational shipment container.
  out.push(pair("bl_container_vs_shipment", g("BILL_OF_LADING", "container_numbers"), op.oceanContainer ?? null, "text", "shipment"));
  // AWB (MAWB) vs air shipment MAWB.
  out.push(pair("awb_vs_air_shipment", g("AIR_WAYBILL", "mawb"), op.airMawb ?? null, "text", "air_shipment"));
  // Certificate origin vs invoice origin.
  out.push(pair("certificate_vs_invoice_origin", g("CERTIFICATE_OF_ORIGIN", "origin_country"), g("COMMERCIAL_INVOICE", "country_of_origin"), "text"));
  // Arrival notice ETA vs voyage ETA.
  out.push(pair("arrival_eta_vs_voyage", g("ARRIVAL_NOTICE", "eta"), op.voyageEta ?? null, "text", "voyage"));
  // Customs value vs invoice total.
  out.push(pair("customs_value_vs_invoice_total", g("CUSTOMS_DECLARATION", "customs_value"), g("COMMERCIAL_INVOICE", "total"), "number"));
  // BL master vs operational master BL.
  out.push(pair("bl_number_vs_shipment", g("BILL_OF_LADING", "bl_number"), op.oceanMasterBl ?? null, "text", "shipment"));

  return out.filter((r) => !(r.status === "MISSING" && r.a == null && r.b == null));
}

/** Invoice self-consistency (subtotal + tax ≈ total). */
export function invoiceConsistency(byClass: FileCandidateMap): ReconResult {
  const inv = byClass.COMMERCIAL_INVOICE ?? {};
  const status = reconcileInvoiceTotals(num(inv.subtotal), num(inv.tax), num(inv.total));
  return { comparison: "invoice_subtotal_tax_total", status, a: inv.subtotal ?? null, b: inv.total ?? null, authoritative: null, humanActionRequired: status === "CONFLICT" };
}
function num(v: string | null | undefined): number | null {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}
