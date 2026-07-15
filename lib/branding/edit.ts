/**
 * Editable tenant branding contract (Phase 6.0E-1). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * The platform branding editor writes a SUBSET of tenant_branding: the safe text +
 * theme values only. Logo / favicon upload is DEFERRED (Phase 6.0F) — there is no
 * approved PUBLIC storage bucket (the only bucket is the private `documents` one),
 * and a branding logo renders in public email/PDF/portal where an expiring signed
 * URL is unusable. So logo_url / portal_logo_url are NEVER touched here; a save
 * preserves whatever provisioning or a future phase set.
 *
 * Validation SURFACES errors (colors must be hex, text rejects markup, email must
 * look like an email) rather than silently dropping them the way the render-time
 * mergeBranding does — the admin must learn a value was rejected, not discover it
 * vanished. The output row carries ONLY the editable columns, each either a trimmed
 * value or null (empty clears the field back to the resolver's fallback).
 */
import { isValidHexColor, containsHtml } from "./validate";
import type { TenantBrandingRow } from "./types";

/** The exact columns the editor owns. logo_url / portal_logo_url are deliberately absent. */
export const EDITABLE_BRANDING_FIELDS = [
  "display_name",
  "primary_color",
  "secondary_color",
  "tagline",
  "support_email",
  "support_phone",
  "email_footer",
  "pdf_header_text",
  "invoice_footer_text",
] as const;

export type EditableBrandingField = (typeof EDITABLE_BRANDING_FIELDS)[number];

/** What the client form submits — every field optional; a string (possibly empty) or absent. */
export type BrandingDraft = Partial<Record<EditableBrandingField, string>>;

export type BrandingFieldError = "invalid_color" | "invalid_text" | "invalid_email";

export type BrandingValidation =
  | { ok: true; row: Record<EditableBrandingField, string | null> }
  | { ok: false; errors: Partial<Record<EditableBrandingField, BrandingFieldError>> };

const COLOR_FIELDS = new Set<EditableBrandingField>(["primary_color", "secondary_color"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A trimmed value, or null when empty (which clears the column back to the fallback). */
function normalize(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Validate a draft into a persistable row of ONLY the editable columns, or a map of
 * per-field errors. Pure and deterministic — the action and the tests share it.
 */
export function validateBrandingDraft(draft: BrandingDraft): BrandingValidation {
  const errors: Partial<Record<EditableBrandingField, BrandingFieldError>> = {};
  const row = {} as Record<EditableBrandingField, string | null>;

  for (const field of EDITABLE_BRANDING_FIELDS) {
    const value = normalize(draft[field]);
    if (value === null) {
      row[field] = null;
      continue;
    }
    if (COLOR_FIELDS.has(field)) {
      if (!isValidHexColor(value)) {
        errors[field] = "invalid_color";
        continue;
      }
    } else if (containsHtml(value)) {
      // Any angle bracket is unsafe in a value that lands in email/PDF/portal.
      errors[field] = "invalid_text";
      continue;
    } else if (field === "support_email" && !EMAIL_RE.test(value)) {
      errors[field] = "invalid_email";
      continue;
    }
    row[field] = value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, row };
}

/**
 * The editable columns that actually CHANGED, comparing a validated row against the
 * currently-persisted row. Used for a safe audit payload — field NAMES only, never
 * the before/after values (a footer or support line is tenant content, not for the
 * platform audit log).
 */
export function changedBrandingFields(
  next: Record<EditableBrandingField, string | null>,
  current: TenantBrandingRow | null,
): EditableBrandingField[] {
  return EDITABLE_BRANDING_FIELDS.filter((f) => {
    const before = (current?.[f] ?? null) as string | null;
    return (next[f] ?? null) !== before;
  });
}
