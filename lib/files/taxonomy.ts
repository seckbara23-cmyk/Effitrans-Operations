/**
 * MAYA dossier-type compatibility taxonomy (MAYA-P0.5-B) — PURE, client +
 * server safe, no I/O.
 * ---------------------------------------------------------------------------
 * MAYA TRANSIT names a dossier with ONE compound label — « IMPORT MARITIME TC
 * SUSPENSIF » — that is really FOUR business dimensions the platform already
 * models separately:
 *
 *   direction    operational_file.type        IMP | EXP | TRP | HND
 *   mode         shipment.transport_mode      SEA | AIR | ROAD | MULTIMODAL
 *   cargo form   shipment.cargo_form          CONTAINER | BULK | PARCEL | GROUPAGE
 *   regime       customs_record.regime        free text; « suspensif » recognised
 *
 * WHY DECOMPOSITION, NOT A WIDER ENUM (ratified, MAYA-P0.5-A §0/§3.1). Seven
 * code sites derive "does this dossier have a customs leg" from
 * operational_file.type, the step registry pins it, and next_file_number
 * validates the same four values inside SQL behind the OPS-SEC-2A trusted
 * overload. Widening that vocabulary to carry MAYA's eight labels would move a
 * display concern into the platform's authorization and workflow spine.
 *
 * THIS MODULE IS NOT A SOURCE OF TRUTH. It derives a LABEL from facts that
 * live in the three tables above and stores nothing. Delete it and no dossier
 * changes.
 *
 * IT NEVER GUESSES. `deriveMayaLabel` matches the proven combinations exactly
 * and returns null for anything else; `resolveMayaType` reports what MAYA-0
 * actually proved and says `unresolved` — with a reason — where the evidence
 * stopped. An unknown combination is an answer, not a defect.
 */
import type { FileType, TransportMode } from "./types";

/** The fourth dimension. Values mirror the shipment.cargo_form CHECK. */
export const CARGO_FORMS = ["CONTAINER", "BULK", "PARCEL", "GROUPAGE"] as const;
export type CargoForm = (typeof CARGO_FORMS)[number];

export function isCargoForm(v: unknown): v is CargoForm {
  return typeof v === "string" && (CARGO_FORMS as readonly string[]).includes(v);
}

export const CARGO_FORM_LABELS_FR: Readonly<Record<CargoForm, string>> = {
  CONTAINER: "Conteneur",
  BULK: "Vrac",
  PARCEL: "Colis",
  GROUPAGE: "Groupage",
};

/**
 * The customs-regime dimension, reduced to what a label needs: is this the
 * SUSPENSIVE regime or not? `customs_record.regime` is free text and stays
 * free text — this only recognises the one marker MAYA's taxonomy uses, and
 * returns null for everything else (including empty). "Not recognised" is
 * never "normal": callers pass what they read, and an unrecognised regime
 * simply cannot produce a SUSPENSIF label.
 */
export type RegimeMarker = "SUSPENSIF" | null;

export function regimeMarker(regime: string | null | undefined): RegimeMarker {
  if (!regime) return null;
  return /suspensif/i.test(regime) ? "SUSPENSIF" : null;
}

/** The four dimensions, as read from the platform's own columns. */
export type DossierDimensions = {
  direction: FileType;
  mode: TransportMode | null;
  cargoForm: CargoForm | null;
  regime: RegimeMarker;
};

/** MAYA dossier types PROVEN by MAYA-0 evidence (register + form observation). */
export const MAYA_TYPE_CODES = [
  "IMPORT_MARITIME_TC",
  "IMPORT_MARITIME_TC_SUSPENSIF",
  "IMPORT_MARITIME_GROUPAGE",
  "EXPORT_MARITIME_VRAC",
  "IMPORT_AERIEN_COLIS",
  "TRANSPORT_UNIQUEMENT",
  "REMISES_DOCUMENTAIRES",
  "AUTRES_DOSSIERS",
] as const;
export type MayaTypeCode = (typeof MAYA_TYPE_CODES)[number];

/**
 * A MAYA type either decomposes onto the four dimensions, or it does not yet —
 * and saying so is the point. `unresolved` entries carry the reason and the
 * open question; they are never mapped by inference.
 */
export type MayaTypeEntry =
  | { code: MayaTypeCode; labelFr: string; dimensions: DossierDimensions }
  | { code: MayaTypeCode; labelFr: string; unresolved: true; reason: string; blockedBy: string };

/**
 * The registry. Every `dimensions` entry is a combination MAYA-0 observed
 * directly; every `unresolved` entry is one it explicitly could not decompose.
 *
 * TRANSPORT_UNIQUEMENT is deliberately mode-less: « transport uniquement »
 * proves there is no customs leg, not that the leg is road. Assuming ROAD
 * would invent a fact the evidence does not carry.
 */
export const MAYA_TYPES: Readonly<Record<MayaTypeCode, MayaTypeEntry>> = {
  IMPORT_MARITIME_TC: {
    code: "IMPORT_MARITIME_TC",
    labelFr: "IMPORT MARITIME TC",
    dimensions: { direction: "IMP", mode: "SEA", cargoForm: "CONTAINER", regime: null },
  },
  IMPORT_MARITIME_TC_SUSPENSIF: {
    code: "IMPORT_MARITIME_TC_SUSPENSIF",
    labelFr: "IMPORT MARITIME TC SUSPENSIF",
    dimensions: { direction: "IMP", mode: "SEA", cargoForm: "CONTAINER", regime: "SUSPENSIF" },
  },
  IMPORT_MARITIME_GROUPAGE: {
    code: "IMPORT_MARITIME_GROUPAGE",
    labelFr: "IMPORT MARITIME GROUPAGE",
    dimensions: { direction: "IMP", mode: "SEA", cargoForm: "GROUPAGE", regime: null },
  },
  EXPORT_MARITIME_VRAC: {
    code: "EXPORT_MARITIME_VRAC",
    labelFr: "EXPORT MARITIME VRAC",
    dimensions: { direction: "EXP", mode: "SEA", cargoForm: "BULK", regime: null },
  },
  IMPORT_AERIEN_COLIS: {
    code: "IMPORT_AERIEN_COLIS",
    labelFr: "IMPORT AÉRIEN COLIS",
    dimensions: { direction: "IMP", mode: "AIR", cargoForm: "PARCEL", regime: null },
  },
  TRANSPORT_UNIQUEMENT: {
    code: "TRANSPORT_UNIQUEMENT",
    labelFr: "TRANSPORT UNIQUEMENT",
    dimensions: { direction: "TRP", mode: null, cargoForm: null, regime: null },
  },
  REMISES_DOCUMENTAIRES: {
    code: "REMISES_DOCUMENTAIRES",
    labelFr: "REMISES DOCUMENTAIRES",
    unresolved: true,
    reason:
      "MAYA-0 could not establish what this dossier type does operationally — "
      + "which stages, which documents, which actor. Mapping it onto a direction "
      + "and a mode would invent the answer.",
    blockedBy: "Q5",
  },
  AUTRES_DOSSIERS: {
    code: "AUTRES_DOSSIERS",
    labelFr: "AUTRES DOSSIERS",
    unresolved: true,
    reason:
      "A catch-all category in MAYA. It has no single decomposition by "
      + "construction; each real dossier filed under it must be classified on "
      + "its own facts.",
    blockedBy: "Q1",
  },
};

export function isResolvedMayaType(
  entry: MayaTypeEntry,
): entry is Extract<MayaTypeEntry, { dimensions: DossierDimensions }> {
  return "dimensions" in entry;
}

/** Look a MAYA type up by code. Unknown code → null (never a fallback entry). */
export function resolveMayaType(code: string): MayaTypeEntry | null {
  return (MAYA_TYPES as Record<string, MayaTypeEntry>)[code] ?? null;
}

/**
 * Match a MAYA label as it appears in the legacy register (« IMPORT MARITIME
 * TC ») onto its entry. Case- and accent-tolerant because legacy text is, but
 * EXACT on content: no partial or fuzzy matching, so « IMPORT MARITIME » alone
 * resolves to nothing rather than to the container variant.
 */
export function matchMayaLabel(label: string): MayaTypeEntry | null {
  const normalise = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const target = normalise(label);
  if (!target) return null;
  for (const entry of Object.values(MAYA_TYPES)) {
    if (normalise(entry.labelFr) === target) return entry;
  }
  return null;
}

/**
 * THE derivation: platform facts → the MAYA-compatible label, or null.
 *
 * Exact match only. A dossier whose dimensions do not correspond to a MAYA
 * type has no MAYA label — which is the truthful answer for a combination
 * MAYA never had, and for a dossier whose cargo form has simply not been
 * entered yet.
 */
export function deriveMayaLabel(dims: DossierDimensions): { code: MayaTypeCode; labelFr: string } | null {
  for (const entry of Object.values(MAYA_TYPES)) {
    if (!isResolvedMayaType(entry)) continue;
    const d = entry.dimensions;
    if (
      d.direction === dims.direction &&
      d.mode === dims.mode &&
      d.cargoForm === dims.cargoForm &&
      d.regime === dims.regime
    ) {
      return { code: entry.code, labelFr: entry.labelFr };
    }
  }
  return null;
}

/**
 * Convenience for surfaces that hold the raw columns: reads the free-text
 * regime through `regimeMarker` and delegates. Same exact-match contract.
 */
export function deriveMayaLabelFromRow(row: {
  type: FileType;
  transportMode: TransportMode | null;
  cargoForm: string | null;
  regime: string | null;
}): { code: MayaTypeCode; labelFr: string } | null {
  return deriveMayaLabel({
    direction: row.type,
    mode: row.transportMode,
    cargoForm: isCargoForm(row.cargoForm) ? row.cargoForm : null,
    regime: regimeMarker(row.regime),
  });
}
