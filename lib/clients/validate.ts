/**
 * Pure validation for client inputs (Phase 1.1). No imports — unit-testable.
 * (NINEA *uniqueness* is enforced by a per-tenant unique index in the DB; this
 * validates format only.)
 */
import type { ClientInput } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// NINEA is numeric; accept 7–13 digits (spaces stripped).
const NINEA_RE = /^\d{7,13}$/;
// Lenient international/local phone: +, digits, spaces, hyphens, parentheses.
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

/** Normalize a NINEA for storage/uniqueness (strip whitespace). */
export function normalizeNinea(ninea: string | null | undefined): string | null {
  const v = (ninea ?? "").replace(/\s/g, "");
  return v === "" ? null : v;
}

/** Returns an error code, or null if the input is valid. */
export function validateClient(input: ClientInput): string | null {
  const name = (input.name ?? "").trim();
  if (!name) return "name_required";

  const ninea = normalizeNinea(input.ninea);
  if (ninea && !NINEA_RE.test(ninea)) return "invalid_ninea";

  const email = (input.email ?? "").trim();
  if (email && !EMAIL_RE.test(email)) return "invalid_email";

  const phone = (input.phone ?? "").trim();
  if (phone && !PHONE_RE.test(phone)) return "invalid_phone";

  // Validate contacts' optional email/phone too.
  for (const c of input.contacts ?? []) {
    if (!(c.name ?? "").trim()) return "contact_name_required";
    const ce = (c.email ?? "").trim();
    if (ce && !EMAIL_RE.test(ce)) return "invalid_email";
    const cp = (c.phone ?? "").trim();
    if (cp && !PHONE_RE.test(cp)) return "invalid_phone";
  }

  return null;
}
