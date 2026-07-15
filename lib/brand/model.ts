/**
 * Digital Brand Center — pure model (DBC-1). No I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * Types, closed vocabularies, validation (reusing the existing branding validators),
 * locked template defaults, and the derived completeness model. Nothing here touches the
 * DB, storage, or the network — the server services (lib/brand/server) call into this.
 *
 * Locked vs. editable: the compliance/sustainability/footer strings are the CEO
 * memorandum's APPROVED copy — they ship as locked defaults and may be OVERRIDDEN per
 * tenant, but a null override always resolves to the approved default (never blank).
 * Brand COLORS are never defaulted — they stay null until the Brand Book supplies them.
 */
import { isSafeUrl, isValidHexColor, safeText, containsHtml } from "@/lib/branding/validate";

// ------------------------------------------------------------- vocabularies ----

export const ASSET_KINDS = [
  "LOGO_PRIMARY",
  "LOGO_REVERSED",
  "LOGO_MONOCHROME",
  "LOGO_EMAIL_PNG",
  "NETWORK_LOGO",
  "EMPLOYEE_PHOTO",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ["DRAFT", "APPROVED", "PUBLISHED", "RETIRED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const SIGNATURE_VARIANTS = ["EXECUTIVE", "MANAGEMENT", "CORPORATE"] as const;
export type SignatureVariant = (typeof SIGNATURE_VARIANTS)[number];

export const MEMBERSHIP_STATUSES = ["active", "inactive"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Fonts the editor accepts — an allowlist, never an arbitrary font-family string. */
export const BRAND_FONTS = ["Montserrat", "Open Sans", "Calibri"] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export function isAssetKind(v: string): v is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(v);
}
export function isSignatureVariant(v: string): v is SignatureVariant {
  return (SIGNATURE_VARIANTS as readonly string[]).includes(v);
}
export function isAllowedFont(v: string | null | undefined): v is BrandFont {
  return typeof v === "string" && (BRAND_FONTS as readonly string[]).includes(v);
}

// ------------------------------------------------------------- validation ----

/** http(s) safe URL that is specifically https (compliance / social / website). */
export function isHttpsUrl(v: string | null | undefined): v is string {
  return isSafeUrl(v) && /^https:\/\//i.test(v.trim());
}

/** A phone value: digits, spaces, +, -, parentheses only; 6–20 chars. Null if empty/invalid. */
export function normalizePhone(v: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v.trim() === "") return { ok: true, value: null };
  const t = v.trim();
  if (!/^\+?[0-9\s().-]{6,20}$/.test(t)) return { ok: false };
  return { ok: true, value: t };
}

export type BrandTextField =
  | "slogan" | "value_proposition" | "address" | "legal_identifiers"
  | "compliance_title" | "compliance_subtitle" | "compliance_description"
  | "compliance_button_label" | "sustainability_statement"
  | "environmental_print_statement" | "footer_line";

export type BrandFieldError = "invalid_color" | "invalid_font" | "invalid_url" | "invalid_https_url" | "invalid_text" | "invalid_phone" | "invalid_variant";

/** Validate a single brand text value (rejects any markup for safe later escaping). */
export function validateBrandText(v: string | undefined): string | null | "ERR" {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return null;
  if (containsHtml(t)) return "ERR";
  return safeText(t) ?? "ERR";
}

// ------------------------------------------------------------- locked defaults ----

export const LOCKED_BRAND_DEFAULTS = {
  compliance_title: "Ethics & Compliance",
  compliance_subtitle: "Confidential Reporting Portal",
  compliance_button_label: "Report Confidentially",
  compliance_description: "Every report is handled confidentially, securely and with integrity.",
  sustainability_statement: "Committed to Sustainable Logistics",
  environmental_print_statement: "Please consider the environment before printing this email.",
  footer_line: "Integrated Logistics • Ethics • Sustainability • Trusted Partnerships",
} as const;

export type ComplianceKey = keyof typeof LOCKED_BRAND_DEFAULTS;
export type ComplianceCopy = Record<ComplianceKey, string>;

/** A null/blank override resolves to the approved locked default — never blank. */
export function resolveComplianceCopy(over: Partial<Record<ComplianceKey, string | null>>): ComplianceCopy {
  const out = {} as ComplianceCopy;
  for (const k of Object.keys(LOCKED_BRAND_DEFAULTS) as ComplianceKey[]) {
    const v = over[k];
    out[k] = v && v.trim() !== "" ? v : LOCKED_BRAND_DEFAULTS[k];
  }
  return out;
}

// ------------------------------------------------------------- completeness ----

export type CompletenessInput = {
  colors: { green: string | null; gold: string | null; anthracite: string | null };
  fonts: { heading: string | null; body: string | null; fallback: string | null };
  slogan: string | null;
  valueProposition: string | null;
  website: string | null;
  address: string | null;
  whistleblowerUrl: string | null;
  /** Published asset kinds present for the tenant. */
  publishedKinds: AssetKind[];
  activeMembershipCount: number;
  workforceWithTitleCount: number;
};

export type CompletenessItem = { key: string; label: string; complete: boolean; evidence: string };
export type BrandCompleteness = { items: CompletenessItem[]; completed: number; total: number; summary: string };

const filled = (v: string | null) => Boolean(v && v.trim() !== "");

/** Derived completeness — honest evidence, no false-precision percentage. */
export function deriveBrandCompleteness(i: CompletenessInput): BrandCompleteness {
  const has = (k: AssetKind) => i.publishedKinds.includes(k);
  const items: CompletenessItem[] = [
    { key: "colors", label: "Couleurs officielles", complete: filled(i.colors.green) && filled(i.colors.gold) && filled(i.colors.anthracite), evidence: "Vert, Or et Anthracite fournis par la Direction." },
    { key: "typography", label: "Typographie", complete: filled(i.fonts.heading) && filled(i.fonts.body) && filled(i.fonts.fallback), evidence: "Police de titre, de corps et de repli Outlook." },
    { key: "logo_primary", label: "Logo principal (PNG)", complete: has("LOGO_PRIMARY"), evidence: "Logo principal publié." },
    { key: "logo_email", label: "Logo e-mail (PNG)", complete: has("LOGO_EMAIL_PNG"), evidence: "Logo optimisé e-mail publié." },
    { key: "slogan", label: "Slogan", complete: filled(i.slogan), evidence: "Slogan renseigné." },
    { key: "value_proposition", label: "Proposition de valeur", complete: filled(i.valueProposition), evidence: "Proposition de valeur renseignée." },
    { key: "website", label: "Site web", complete: filled(i.website), evidence: "URL du site renseignée." },
    { key: "address", label: "Adresse", complete: filled(i.address), evidence: "Adresse renseignée." },
    { key: "compliance", label: "URL de signalement", complete: filled(i.whistleblowerUrl), evidence: "Portail de signalement configuré." },
    { key: "memberships", label: "Réseaux internationaux", complete: i.activeMembershipCount > 0, evidence: "Au moins une adhésion active." },
    { key: "workforce", label: "Identité collaborateurs", complete: i.workforceWithTitleCount > 0, evidence: "Au moins un collaborateur avec fonction." },
  ];
  const completed = items.filter((x) => x.complete).length;
  const total = items.length;
  return { items, completed, total, summary: `${completed} éléments sur ${total} complétés` };
}
