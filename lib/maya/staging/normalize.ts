/**
 * MAYA migration staging — normalisation (MAYA-P0.5-C). PURE. No I/O.
 * ---------------------------------------------------------------------------
 * Turns one verbatim MAYA source record into the platform's candidate shape.
 * Three rules govern everything here:
 *
 *  1. THE RAW RECORD IS NEVER DISCARDED. Normalisation produces candidates
 *     ALONGSIDE the payload; the staging row keeps `raw` verbatim so a
 *     reviewer can always see what MAYA actually said.
 *  2. NOTHING IS INVENTED. A value that cannot be parsed is recorded in
 *     `malformed` for validation to name — never coerced to 0, to today, or
 *     to a plausible default.
 *  3. THE TAXONOMY IS NOT REIMPLEMENTED. lib/files/taxonomy.ts is the ratified
 *     authority; this module calls it and records what it answered, including
 *     "this MAYA type is not decomposed" (REMISES DOCUMENTAIRES, AUTRES
 *     DOSSIERS), which stays UNRESOLVED with the original label preserved.
 *
 * Legacy text is French and hand-typed: dates arrive as JJ/MM/AAAA as often as
 * ISO, and numbers carry comma decimals and space thousands separators. Both
 * are read; anything else is malformed, not guessed.
 */
import { isResolvedMayaType, matchMayaLabel, regimeMarker } from "@/lib/files/taxonomy";
import { sourceRowHash } from "./identity";
import type { NormalizedRow, TaxonomyResolution } from "./types";

/**
 * The canonical staging concepts a MAYA export can feed. The importer maps
 * SOURCE COLUMN NAMES onto these; MAYA's own column names differ per export
 * and per table, so no source header is hardcoded here.
 */
export const MAYA_FIELDS = [
  "source_record_id",
  "dossier_reference",
  "parent_reference",
  "type_label",
  "opening_date",
  "client_reference",
  "client_name",
  "vessel_or_flight",
  "bl_awb_ref",
  "origin",
  "destination",
  "regime",
  "goods_description",
  "goods_nature",
  "supplier_name",
  "quantity",
  "quantity_unit",
  "net_weight_kg",
  "gross_weight_kg",
  "volume_m3",
  "package_count",
  "container_count",
  "container_numbers",
  "declaration_reference",
  "warehouse_entry_date",
  "processing_due_date",
  "delivery_reference",
] as const;
export type MayaField = (typeof MAYA_FIELDS)[number];

/** source column name → canonical field. Absent field = not supplied. */
export type MayaColumnMap = Partial<Record<MayaField, string>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FR_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** ISO or JJ/MM/AAAA → ISO. `undefined` means "present but unreadable". */
export function parseLegacyDate(value: string): string | null | undefined {
  const v = value.trim();
  if (!v) return null;
  if (ISO_DATE.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 ? v : undefined;
  }
  const fr = FR_DATE.exec(v);
  if (!fr) return undefined;
  const [, d, m, y] = fr;
  const day = Number(d), month = Number(m), year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** French or plain decimals. `undefined` means "present but unreadable". */
export function parseLegacyNumber(value: string): number | null | undefined {
  const v = value.replace(/[\s  ]/g, "").trim();
  if (!v) return null;
  // A comma is the decimal separator in French; a dot may be a thousands
  // separator when a comma is also present (1.234,56).
  const normalised = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return undefined;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : undefined;
}

/** Container numbers arrive as one cell, separated however the operator typed. */
export function splitContainerNumbers(value: string): string[] {
  return value
    .split(/[,;\n\r|/]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export type NormalizeInput = {
  sourceTable: string;
  raw: Record<string, string>;
  mapping: MayaColumnMap;
};

export function normalizeRow({ sourceTable, raw, mapping }: NormalizeInput): NormalizedRow {
  const malformed: { field: string; value: string }[] = [];

  const pick = (field: MayaField): string => {
    const column = mapping[field];
    if (!column) return "";
    return (raw[column] ?? "").trim();
  };
  const text = (field: MayaField): string | null => pick(field) || null;

  const date = (field: MayaField): string | null => {
    const v = pick(field);
    const parsed = parseLegacyDate(v);
    if (parsed === undefined) { malformed.push({ field, value: v }); return null; }
    return parsed;
  };
  const number = (field: MayaField): number | null => {
    const v = pick(field);
    const parsed = parseLegacyNumber(v);
    if (parsed === undefined) { malformed.push({ field, value: v }); return null; }
    return parsed;
  };

  // ---- taxonomy: ask the ratified authority, record exactly what it said.
  const typeLabel = text("type_label");
  const regimeRaw = text("regime");
  let taxonomyResolution: TaxonomyResolution = "UNKNOWN";
  let direction: string | null = null;
  let mode: string | null = null;
  let cargoForm: string | null = null;

  if (typeLabel) {
    const entry = matchMayaLabel(typeLabel);
    if (entry && isResolvedMayaType(entry)) {
      taxonomyResolution = "RESOLVED";
      direction = entry.dimensions.direction;
      mode = entry.dimensions.mode;
      cargoForm = entry.dimensions.cargoForm;
    } else if (entry) {
      // Known to MAYA, deliberately not decomposed by MAYA-0 (Q1/Q5).
      taxonomyResolution = "UNRESOLVED";
    }
  }

  // The regime dimension is read from the export's own regime column when it
  // has one; the type label alone can also carry it (…TC SUSPENSIF).
  const regimeFromLabel = typeLabel ? regimeMarker(typeLabel) : null;
  const normalizedRegime = regimeMarker(regimeRaw) ?? regimeFromLabel;

  const containersRaw = pick("container_numbers");
  const containerNumbers = containersRaw ? splitContainerNumbers(containersRaw) : [];

  return {
    sourceTable,
    sourceRecordId: text("source_record_id"),
    sourceDossierReference: text("dossier_reference"),
    sourceParentReference: text("parent_reference"),
    sourceRowHash: sourceRowHash(sourceTable, raw),

    sourceTypeLabel: typeLabel,
    normalizedDirection: direction,
    normalizedMode: mode,
    normalizedCargoForm: cargoForm,
    normalizedRegime,
    taxonomyResolution,

    clientReferenceRaw: text("client_reference"),
    clientNameRaw: text("client_name"),

    openingDate: date("opening_date"),
    vesselOrFlight: text("vessel_or_flight"),
    blAwbRef: text("bl_awb_ref"),
    originRaw: text("origin"),
    destinationRaw: text("destination"),

    goodsDescription: text("goods_description"),
    goodsNature: text("goods_nature"),
    supplierName: text("supplier_name"),
    cargoQuantity: number("quantity"),
    cargoQuantityUnit: text("quantity_unit"),
    netWeightKg: number("net_weight_kg"),
    grossWeightKg: number("gross_weight_kg"),
    volumeM3: number("volume_m3"),
    packageCount: number("package_count"),
    containerCount: number("container_count"),
    containerNumbers,

    declarationReference: text("declaration_reference"),
    warehouseEntryDate: date("warehouse_entry_date"),
    processingDueDate: date("processing_due_date"),
    deliveryReference: text("delivery_reference"),

    malformed,
  };
}
