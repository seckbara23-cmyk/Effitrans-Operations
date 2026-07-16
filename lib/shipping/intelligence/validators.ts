/**
 * Shipping Line Platform — identifier validators (Phase 7.2A). PURE, total (never throw).
 * ---------------------------------------------------------------------------
 * Container numbers (ISO 6346), IMO numbers, MMSI, and UN/LOCODE are DISTINCT identifier
 * types with distinct rules. Validate them at the persistence boundary so a typo or a bad
 * provider value can't masquerade as a real identifier.
 */

/** Normalise: upper-case, strip spaces/hyphens. */
function clean(v: string): string {
  return String(v ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/**
 * ISO 6346 container number: 4 letters (owner code + equipment category U/J/Z) + 6 digits
 * + 1 check digit. The check digit is a mod-11 weighting over the first 10 characters.
 */
export function isValidContainerNumber(raw: string): boolean {
  const v = clean(raw);
  if (!/^[A-Z]{3}[UJZ][0-9]{6}[0-9]$/.test(v)) return false;
  // Letter values per ISO 6346 (skip multiples of 11: 11,22,33 are excluded from the run).
  const value = (ch: string): number => {
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
    let n = ch.charCodeAt(0) - 55; // A=10, B=11, ...
    n += Math.floor((n - 1) / 10); // skip 11, 22, 33
    return n;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += value(v[i]) * 2 ** i;
  const check = sum % 11 % 10; // 11 → 0
  return check === Number(v[10]);
}

/**
 * IMO ship number: optional "IMO" prefix + 7 digits. Check digit = (Σ dᵢ·(7−i) for i=0..5)
 * mod 10, compared to the 7th digit.
 */
export function isValidIMO(raw: string): boolean {
  const v = clean(raw).replace(/^IMO/, "");
  if (!/^[0-9]{7}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(v[i]) * (7 - i);
  return sum % 10 === Number(v[6]);
}

/** MMSI: exactly 9 digits. A DIFFERENT identifier type from IMO (never interchangeable). */
export function isValidMMSI(raw: string): boolean {
  return /^[0-9]{9}$/.test(clean(raw));
}

/** UN/LOCODE: 2-letter ISO-3166 country + 3-char alphanumeric location code. */
export function isValidUnlocode(raw: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{3}$/.test(clean(raw));
}

/** WGS84 coordinate sanity — pure guard so no out-of-range/NaN position is ever stored. */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    !(lat === 0 && lon === 0) // null-island is treated as "no fix"
  );
}

/** Normalise a container number for storage/comparison (or null if invalid). */
export function normalizeContainerNumber(raw: string): string | null {
  const v = clean(raw);
  return isValidContainerNumber(v) ? v : null;
}

/** Normalise a UN/LOCODE for storage (or null if invalid). */
export function normalizeUnlocode(raw: string): string | null {
  const v = clean(raw);
  return isValidUnlocode(v) ? v : null;
}
