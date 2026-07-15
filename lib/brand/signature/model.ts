/**
 * Signature model (DBC-2). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * Resolves the Brand Center (company) + employee data into ONE deterministic model that
 * the server compiler turns into HTML / plain text. It is the single source of truth for a
 * signature; it duplicates no branding logic (values come pre-resolved from lib/brand).
 *
 * Readiness gates PUBLICATION: a production signature is refused when required brand inputs
 * are missing (logo, official green, address, compliance URL) or the employee has no title.
 * Nothing is silently substituted — the caller shows the missing items instead.
 */
import type { SignatureVariant } from "@/lib/brand/model";
import type { BrandProfile, BrandAssetView, MembershipView } from "@/lib/brand/server/service";

export type SignatureMembership = { name: string; logoUrl: string | null; logoAlt: string };

export type SignatureModel = {
  variant: SignatureVariant;
  company: { name: string; slogan: string | null; valueProposition: string | null; website: string | null; address: string | null; footer: string };
  colors: { green: string; anthracite: string };
  employee: { name: string; title: string; email: string; phoneOffice: string | null; phoneMobile: string | null; whatsapp: string | null };
  logoUrl: string | null;
  logoAlt: string;
  memberships: SignatureMembership[];
  compliance: { buttonLabel: string; portalUrl: string; title: string; subtitle: string };
  sustainability: string;
  environmentalPrint: string;
};

export type SignatureEmployee = {
  name: string; email: string; title: string | null; variant: SignatureVariant;
  phoneOffice: string | null; phoneMobile: string | null; whatsapp: string | null;
};

/** The active published logo for email use (email PNG preferred, primary as fallback). */
function pickLogo(assets: BrandAssetView[]): BrandAssetView | null {
  const published = assets.filter((a) => a.status === "PUBLISHED");
  return (
    published.find((a) => a.kind === "LOGO_EMAIL_PNG") ??
    published.find((a) => a.kind === "LOGO_PRIMARY") ??
    null
  );
}

export type SignatureReadiness = { ready: boolean; missing: string[] };

/** Whether a production signature may be generated, and what is missing if not. */
export function signatureReadiness(profile: BrandProfile, assets: BrandAssetView[], employee: SignatureEmployee): SignatureReadiness {
  const missing: string[] = [];
  if (!pickLogo(assets)) missing.push("Logo e-mail approuvé (PNG)");
  if (!profile.colorGreen) missing.push("Couleur verte officielle");
  if (!profile.address) missing.push("Adresse de l'entreprise");
  if (!profile.whistleblowerUrl) missing.push("URL du portail de signalement");
  if (!employee.title || employee.title.trim() === "") missing.push("Fonction du collaborateur");
  return { ready: missing.length === 0, missing };
}

/**
 * Build the resolved model. Assumes readiness has passed (green/address/logo/whistleblower/
 * title present) — the fallbacks here are only for the optional accents, never for the
 * gated-required values.
 */
export function buildSignatureModel(input: {
  companyName: string;
  profile: BrandProfile;
  assets: BrandAssetView[];
  memberships: MembershipView[];
  employee: SignatureEmployee;
}): SignatureModel {
  const { profile, assets, memberships, employee } = input;
  const logo = pickLogo(assets);
  const assetUrl = new Map(assets.map((a) => [a.id, { url: a.publicUrl, alt: a.altText }]));

  const activeMemberships: SignatureMembership[] = memberships
    .filter((m) => m.status === "active")
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => {
      const logoRef = m.logoAssetId ? assetUrl.get(m.logoAssetId) : undefined;
      return { name: m.organizationName, logoUrl: logoRef?.url ?? null, logoAlt: logoRef?.alt ?? m.organizationName };
    });

  return {
    variant: employee.variant,
    company: {
      name: input.companyName,
      slogan: profile.slogan,
      valueProposition: profile.valueProposition,
      website: profile.websiteUrl,
      address: profile.address,
      footer: profile.compliance.footer_line,
    },
    colors: { green: profile.colorGreen ?? "#0F766E", anthracite: profile.colorAnthracite ?? "#333F48" },
    employee: {
      name: employee.name, title: employee.title ?? "", email: employee.email,
      phoneOffice: employee.phoneOffice, phoneMobile: employee.phoneMobile, whatsapp: employee.whatsapp,
    },
    logoUrl: logo?.publicUrl ?? null,
    logoAlt: logo?.altText ?? input.companyName,
    memberships: activeMemberships,
    compliance: {
      buttonLabel: profile.compliance.compliance_button_label,
      portalUrl: profile.whistleblowerUrl ?? "",
      title: profile.compliance.compliance_title,
      subtitle: profile.compliance.compliance_subtitle,
    },
    sustainability: profile.compliance.sustainability_statement,
    environmentalPrint: profile.compliance.environmental_print_statement,
  };
}
