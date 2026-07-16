/**
 * Air Cargo — identifier validators (Phase 7.3A). PURE, total. IATA and ICAO are DISTINCT
 * code systems with distinct lengths. Coordinate/reference validation is reused from the
 * shipping generic layer (no duplication).
 */
export { isValidCoordinate, normalizeContainerNumber } from "@/lib/shipping/intelligence/validators";
export { normalizeReference } from "@/lib/shipping/intelligence/manage-validate";

function clean(v: string): string {
  return String(v ?? "").toUpperCase().replace(/\s+/g, "");
}

/** Airline IATA: 2 alphanumeric (e.g. "AF"). Airport IATA: 3 letters (e.g. "DKR"). */
export function isValidIataAirline(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true; // optional
  return /^[A-Z0-9]{2}$/.test(clean(raw));
}
export function isValidIataAirport(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  return /^[A-Z]{3}$/.test(clean(raw));
}

/** Airline ICAO: 3 letters (e.g. "AFR"). Airport ICAO: 4 letters (e.g. "GOBD"). */
export function isValidIcaoAirline(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  return /^[A-Z]{3}$/.test(clean(raw));
}
export function isValidIcaoAirport(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  return /^[A-Z]{4}$/.test(clean(raw));
}

export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  return clean(raw);
}
