/**
 * Document Intelligence — deterministic validation + normalization (Phase 7.4A). PURE.
 * REUSES the existing domain validators (ISO 6346 / IMO / MMSI / UN/LOCODE / IATA). Never
 * asks AI to replace deterministic validation. A conflict with an operational value is
 * SHOWN (CONFLICT), never silently resolved.
 */
import { isValidContainerNumber, isValidIMO, isValidMMSI, isValidUnlocode, normalizeContainerNumber } from "@/lib/shipping/intelligence/validators";
import { isValidIataAirport } from "@/lib/air/intelligence/validators";
import type { FieldKind } from "./schemas";
import type { ValidationStatus } from "./types";

/** Air waybill: 3-digit airline prefix + 8-digit serial; last serial digit = serial(7) mod 7. */
export function isValidAwb(raw: string): boolean {
  const v = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (!/^\d{11}$/.test(v)) return false;
  const serial = v.slice(3);
  return Number(serial.slice(0, 7)) % 7 === Number(serial[7]);
}

export function isValidCurrency(raw: string): boolean {
  return /^[A-Z]{3}$/.test(String(raw ?? "").trim().toUpperCase());
}

/** Normalize a candidate raw value by kind (dates → ISO date; numbers → decimal string;
 *  codes → upper/trimmed). Returns null when nothing meaningful remains. */
export function normalizeField(kind: FieldKind, raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  switch (kind) {
    case "container": return normalizeContainerNumber(v) ?? v.toUpperCase().replace(/\s/g, "");
    case "awb": return v.toUpperCase().replace(/[\s-]/g, "");
    case "unlocode": case "iata": case "imo": case "mmsi": return v.toUpperCase().replace(/\s/g, "");
    case "currency": return v.toUpperCase();
    case "number": { const n = v.replace(/[^0-9.,-]/g, "").replace(/\s/g, "").replace(",", "."); return n || null; }
    case "date": { const d = parseDate(v); return d ?? v; }
    default: return v;
  }
}

/** Best-effort date → YYYY-MM-DD (accepts ISO, dd/mm/yyyy, dd-mm-yyyy). null if unparseable. */
export function parseDate(raw: string): string | null {
  const v = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(v);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0"), mm = dmy[2].padStart(2, "0");
    const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const t = new Date(`${yyyy}-${mm}-${dd}`).getTime();
    return Number.isFinite(t) ? `${yyyy}-${mm}-${dd}` : null;
  }
  return null;
}

/** Deterministic format validation for a normalized value. Empty ⇒ MISSING_REQUIRED_CONTEXT. */
export function validateFieldFormat(kind: FieldKind, normalized: string | null): ValidationStatus {
  if (normalized == null || normalized === "") return "MISSING_REQUIRED_CONTEXT";
  switch (kind) {
    case "container": return isValidContainerNumber(normalized) ? "VALID" : "INVALID_FORMAT";
    case "awb": return isValidAwb(normalized) ? "VALID" : "INVALID_FORMAT";
    case "unlocode": return isValidUnlocode(normalized) ? "VALID" : "INVALID_FORMAT";
    case "iata": return isValidIataAirport(normalized) ? "VALID" : "INVALID_FORMAT";
    case "imo": return isValidIMO(normalized) ? "VALID" : "INVALID_FORMAT";
    case "mmsi": return isValidMMSI(normalized) ? "VALID" : "INVALID_FORMAT";
    case "currency": return isValidCurrency(normalized) ? "VALID" : "INVALID_FORMAT";
    case "date": return parseDate(normalized) ? "VALID" : "INVALID_FORMAT";
    case "number": return Number.isFinite(Number(normalized)) ? "VALID" : "INVALID_FORMAT";
    default: return "VALID"; // free text / reference: presence already checked
  }
}

/** Reconcile a normalized candidate against a current operational value. */
export function reconcileWithOperational(candidate: string | null, current: string | null | undefined): "AGREEMENT" | "CONFLICT" | "NONE" {
  if (candidate == null) return "NONE";
  if (current == null || current === "") return "NONE"; // nothing to compare against
  return candidate.trim().toUpperCase() === current.trim().toUpperCase() ? "AGREEMENT" : "CONFLICT";
}

/** Invoice total reconciliation: subtotal + tax ≈ total (2-decimal tolerance). */
export function reconcileInvoiceTotals(subtotal: number | null, tax: number | null, total: number | null): "AGREEMENT" | "CONFLICT" | "MISSING" {
  if (subtotal == null || total == null) return "MISSING";
  return Math.abs((subtotal + (tax ?? 0)) - total) <= 0.01 ? "AGREEMENT" : "CONFLICT";
}
