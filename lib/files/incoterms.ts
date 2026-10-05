/**
 * Incoterms® — the governed commercial-condition vocabulary (INCOTERM-CATALOG-01).
 * PURE, client + server safe, no I/O.
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT.
 *
 * An Incoterm describes the commercial condition agreed between BUYER and
 * SELLER — who bears cost and risk, and to what point. It says nothing about
 * what Effitrans was contracted to do.
 *
 * « Services demandés » remains the ONLY authority on Effitrans service scope.
 * So nothing in this module, and nothing that reads it, may derive a workflow
 * step, a service, a permission, an assignment, a handoff, customs
 * responsibility or transport responsibility from the Incoterm. CIF does not
 * enable Transport. FOB does not change the customs chain. A dossier whose
 * Incoterm is DDP and whose services are « Dédouanement » only is perfectly
 * coherent, and the platform must keep treating it that way.
 *
 * This module therefore exports a vocabulary, three labels and one formatter.
 * It stores nothing, decides nothing and reaches nothing. Delete it and no
 * dossier changes state.
 *
 * WHY A CONSTANT AND A CHECK, NOT A CATALOGUE TABLE. Eleven values fixed by an
 * international standard, with no tenant extensibility, no metadata, no CRUD and
 * no lifecycle. That is exactly the shape `shipment.transport_mode` and
 * `shipment.cargo_form` already have: an `as const` tuple with a type guard on
 * the application side, mirroring a CHECK constraint on the column. A table
 * would add RLS policies, grants, seed rows and a foreign key to express a list
 * that cannot change without the ICC changing it — and migration 116 already
 * warns against introducing a second model where one suffices.
 *
 * THE DATABASE IS STILL THE AUTHORITY. `shipment_incoterm_check` rejects
 * anything outside this tuple, so a write that bypasses `validateFile` is
 * refused by Postgres rather than stored. The guard here exists to give the
 * operator a sentence, never instead of the constraint.
 *
 * Values mirror the shipment.incoterm CHECK, in Incoterms® 2020 order.
 */

/** The eleven Incoterms® Effitrans Transit uses. Mirrors shipment_incoterm_check. */
export const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DPU",
  "DAP",
  "DDP",
] as const;

export type Incoterm = (typeof INCOTERMS)[number];

export function isIncoterm(v: unknown): v is Incoterm {
  return typeof v === "string" && (INCOTERMS as readonly string[]).includes(v);
}

/**
 * The official term for each code. Deliberately NOT translated: an Incoterm's
 * name is the standardised trade term, used verbatim in French logistics
 * practice, and inventing a French rendering would make the selector disagree
 * with the documents it describes. The FIELD labels are French and live in
 * lib/i18n.ts; these are the terms themselves.
 */
export const INCOTERM_LABELS: Readonly<Record<Incoterm, string>> = {
  EXW: "Ex Works",
  FCA: "Free Carrier",
  FAS: "Free Alongside Ship",
  FOB: "Free On Board",
  CFR: "Cost and Freight",
  CIF: "Cost, Insurance and Freight",
  CPT: "Carriage Paid To",
  CIP: "Carriage and Insurance Paid To",
  DPU: "Delivered at Place Unloaded",
  DAP: "Delivered at Place",
  DDP: "Delivered Duty Paid",
};

/**
 * What a selector shows, so nobody has to memorise the codes — « CIF — Cost,
 * Insurance and Freight ». Only the CODE is ever persisted.
 */
export function incotermOptionLabel(code: Incoterm): string {
  return `${code} — ${INCOTERM_LABELS[code]}`;
}

/**
 * The ONE display rule, so « CIF — Dakar » is composed identically everywhere.
 *
 *   code + place  ->  "CIF — Dakar"
 *   code only     ->  "CIF"
 *   no code       ->  null, whatever the place says
 *
 * A NAMED PLACE WITHOUT A CODE IS NOT INCOTERM DATA. The place is contractual
 * only in relation to a term, so it is never shown on its own: that would invent
 * an Incoterm fact out of a location. Returning null lets the caller use the
 * surface's existing absent-value convention rather than fabricating one here.
 *
 * A non-canonical stored code (only possible on data predating
 * shipment_incoterm_check) is passed through verbatim rather than hidden —
 * history is shown as it is, never silently corrected.
 */
export function formatIncoterm(
  code: string | null | undefined,
  place: string | null | undefined,
): string | null {
  const c = code?.trim();
  if (!c) return null;
  const p = place?.trim();
  return p ? `${c} — ${p}` : c;
}
