/**
 * Dossier-opening facts (CEO-ALIGNMENT WP1-B1/C) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * CEO-003: « L'account manager doit spécifier et inscrire le PO client, le
 * régime douanier a l'ouverture du dossier. »
 *
 * Two facts, two different natures, and this module keeps them apart:
 *
 *   PO client             DEC-CEO-02. The customer's purchase-order reference.
 *                         Optional at creation. It is DUE before step 3 closes
 *                         on an import dossier — but NOT ENFORCED until WP1
 *                         PR-2 ratifies the exception policy (DEC-CEO-19). Until
 *                         then a missing PO is « Information à compléter »:
 *                         visible, recorded, never blocking.
 *
 *   Régime douanier prévu DEC-CEO-03. The Account Manager's EXPECTATION at
 *                         opening — preliminary customer/Operations
 *                         information. It is not a declaration and not a
 *                         classification: the declared regime stays
 *                         `customs_record.regime`, entered by the Déclarant and
 *                         certified by the Chef de Transit. Nothing here ever
 *                         reads one as the other.
 *
 * WHY THE MISSING PO IS NOT A REGISTRY REQUIREMENT IN THIS SLICE. Adding a key
 * to step 3's `requiredDocuments` was the obvious route and was rejected for two
 * verified reasons: the department queue marks a step `blocked` on ANY missing
 * evidence regardless of its leniency class (lib/process/queues/service.ts), so
 * a non-blocking requirement would have read « Pièces manquantes » on every
 * import dossier; and step 3's required set is pinned EMPTY by the H-3/H-4/H-5
 * ratification. Both change in PR-2, together with the HARD rule they belong to.
 */
import type { FileStatus, FileType } from "./types";
import { TERMINAL_FILE_STATUSES } from "./status";

/** DB CHECK `operational_file_client_po_reference_shape` (migration #158). */
export const CLIENT_PO_MAX = 64;
/** DB CHECK `operational_file_customs_regime_declared_shape` (migration #158). */
export const REGIME_DECLARED_MAX = 80;

/** Dossier types for which a PO is due at opening (DEC-CEO-02: « IMP applicables »). */
export function clientPoDueForFileType(type: FileType | string): boolean {
  return type === "IMP";
}

/** Normalise an operator entry: trimmed, empty → null (never ''). */
export function normalizeOpeningText(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/**
 * Validate the two opening facts. Absence is always valid — both are optional
 * at creation. Returns an error code from `t.files.errors`, or null.
 */
export function validateOpeningFacts(input: {
  clientPoReference?: string | null;
  customsRegimeDeclared?: string | null;
}): string | null {
  const po = normalizeOpeningText(input.clientPoReference);
  if (po !== null && po.length > CLIENT_PO_MAX) return "invalid_client_po_reference";
  const regime = normalizeOpeningText(input.customsRegimeDeclared);
  if (regime !== null && regime.length > REGIME_DECLARED_MAX) return "invalid_customs_regime_declared";
  return null;
}

const TERMINAL: ReadonlySet<string> = new Set<string>(TERMINAL_FILE_STATUSES);

export type OpeningAdvisory = { key: string; messageFr: string };

/**
 * « Informations à compléter » contributed by the opening facts — the SAME
 * register `requirementMessageFr` uses for a non-blocking requirement, so the
 * operator reads one voice on the dossier.
 *
 * Shown only when the platform can store a PO (`stored`), on an import dossier
 * that is still live. A closed or cancelled dossier asks for nothing.
 */
export function openingAdvisories(input: {
  stored: boolean;
  type: FileType | string;
  status: FileStatus | string;
  clientPoReference: string | null | undefined;
}): OpeningAdvisory[] {
  if (!input.stored) return [];
  if (TERMINAL.has(input.status)) return [];
  if (!clientPoDueForFileType(input.type)) return [];
  if (normalizeOpeningText(input.clientPoReference) !== null) return [];
  return [
    {
      key: "am_dossier_opening::CLIENT_PO_REFERENCE",
      messageFr:
        "Information à compléter : PO client (ouverture du dossier, étape 3). Vous pouvez poursuivre les opérations autorisées.",
    },
  ];
}

/** The read-only line the customs panel shows to Transit. */
export function regimeDeclaredNoticeFr(regime: string | null | undefined): string | null {
  const r = normalizeOpeningText(regime);
  if (r === null) return null;
  return `Régime douanier prévu à l'ouverture : ${r} — information préliminaire des Opérations, non déclarative.`;
}
