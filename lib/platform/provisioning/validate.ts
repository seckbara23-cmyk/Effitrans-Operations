/**
 * Provisioning input validation (Phase 4.0B-2). PURE — no I/O, unit-testable.
 */
import { isPlanKey } from "../entitlements";
import type { ProvisionTenantInput } from "./contract";

export type ValidationResult = { ok: boolean; errors: string[] };

// Slugs become tenant subdomains / URL segments later, so keep them DNS- and
// URL-safe and never collide with a platform-reserved word.
export const RESERVED_SLUGS = new Set<string>([
  "platform", "admin", "api", "www", "app", "portal", "driver", "login", "auth",
  "dashboard", "settings", "public", "static", "assets", "status", "health",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/; // 3–40 chars, no leading/trailing hyphen
const CURRENCY_RE = /^[A-Z]{3}$/;
const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/; // fr, en, fr-FR
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSlug(slug: string): ValidationResult {
  const errors: string[] = [];
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    errors.push("slug must be 3–40 lowercase letters/digits/hyphens, no leading or trailing hyphen");
  }
  if (RESERVED_SLUGS.has(slug)) errors.push(`slug "${slug}" is reserved`);
  return { ok: errors.length === 0, errors };
}

export function validateProvisionInput(input: ProvisionTenantInput): ValidationResult {
  const errors: string[] = [];
  const c = input.company ?? ({} as ProvisionTenantInput["company"]);

  if (!c.legalName?.trim()) errors.push("company.legalName is required");
  errors.push(...validateSlug(c.slug ?? "").errors);
  if (!c.country?.trim()) errors.push("company.country is required");
  if (!CURRENCY_RE.test(c.currency ?? "")) errors.push("company.currency must be a 3-letter ISO code (e.g. XOF)");
  if (!c.timezone?.trim()) errors.push("company.timezone is required");
  if (!LANG_RE.test(c.language ?? "")) errors.push("company.language must be a locale like 'fr' or 'fr-FR'");
  if (c.email && !EMAIL_RE.test(c.email)) errors.push("company.email is malformed");

  if (!input.administrator?.fullName?.trim()) errors.push("administrator.fullName is required");
  if (!EMAIL_RE.test(input.administrator?.email ?? "")) errors.push("administrator.email is required and must be valid");

  if (!isPlanKey(input.plan)) errors.push(`plan "${input.plan}" is not a valid plan key`);
  if (!input.idempotencyKey?.trim()) errors.push("idempotencyKey is required");

  return { ok: errors.length === 0, errors };
}
