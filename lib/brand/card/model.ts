/**
 * Digital business card model (DBC-3). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * The PUBLIC-safe identity resolved from the Brand Center. It carries display data only —
 * NO tenant id, user id, database id, token, or storage path. Readiness gates PUBLICATION:
 * an incomplete brand (no logo / green / compliance URL / address) does not publish.
 */
import type { BrandProfile, BrandAssetView, MembershipView } from "@/lib/brand/server/service";
import type { SignatureMembership } from "@/lib/brand/signature/model";

export type CardModel = {
  company: { name: string; logoUrl: string | null; logoAlt: string; address: string | null; website: string | null; footer: string };
  colors: { green: string; anthracite: string };
  employee: {
    name: string; title: string | null; department: string | null; email: string;
    phoneOffice: string | null; phoneMobile: string | null; whatsapp: string | null; photoUrl: string | null;
  };
  memberships: SignatureMembership[];
  compliance: { buttonLabel: string; portalUrl: string; title: string; subtitle: string };
  sustainability: string;
  environmentalPrint: string;
  /** Absolute public URL of this card (for the QR target + vCard). */
  profileUrl: string;
};

function pickLogo(assets: BrandAssetView[]): BrandAssetView | null {
  const pub = assets.filter((a) => a.status === "PUBLISHED");
  return pub.find((a) => a.kind === "LOGO_EMAIL_PNG") ?? pub.find((a) => a.kind === "LOGO_PRIMARY") ?? null;
}

export type CardReadiness = { ready: boolean; missing: string[] };

/** Whether a public card may publish, and what brand inputs are missing if not. */
export function cardReadiness(profile: BrandProfile, assets: BrandAssetView[]): CardReadiness {
  const missing: string[] = [];
  if (!pickLogo(assets)) missing.push("Logo officiel (PNG)");
  if (!profile.colorGreen) missing.push("Couleur verte officielle");
  if (!profile.whistleblowerUrl) missing.push("URL du portail de signalement");
  if (!profile.address) missing.push("Adresse de l'entreprise");
  return { ready: missing.length === 0, missing };
}

export type CardEmployee = {
  name: string; title: string | null; department: string | null; email: string;
  phoneOffice: string | null; phoneMobile: string | null; whatsapp: string | null; photoAssetId: string | null;
};

export function buildCardModel(input: {
  companyName: string; profileUrl: string;
  profile: BrandProfile; assets: BrandAssetView[]; memberships: MembershipView[]; employee: CardEmployee;
}): CardModel {
  const { profile, assets, memberships, employee } = input;
  const logo = pickLogo(assets);
  const assetUrl = new Map(assets.map((a) => [a.id, { url: a.publicUrl, alt: a.altText }]));
  const photo = employee.photoAssetId ? assetUrl.get(employee.photoAssetId) : undefined;

  const activeMemberships: SignatureMembership[] = memberships
    .filter((m) => m.status === "active")
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => {
      const ref = m.logoAssetId ? assetUrl.get(m.logoAssetId) : undefined;
      return { name: m.organizationName, logoUrl: ref?.url ?? null, logoAlt: ref?.alt ?? m.organizationName };
    });

  return {
    company: {
      name: input.companyName, logoUrl: logo?.publicUrl ?? null, logoAlt: logo?.altText ?? input.companyName,
      address: profile.address, website: profile.websiteUrl, footer: profile.compliance.footer_line,
    },
    colors: { green: profile.colorGreen ?? "#0F766E", anthracite: profile.colorAnthracite ?? "#333F48" },
    employee: {
      name: employee.name, title: employee.title, department: employee.department, email: employee.email,
      phoneOffice: employee.phoneOffice, phoneMobile: employee.phoneMobile, whatsapp: employee.whatsapp,
      photoUrl: photo?.url ?? null,
    },
    memberships: activeMemberships,
    compliance: {
      buttonLabel: profile.compliance.compliance_button_label, portalUrl: profile.whistleblowerUrl ?? "",
      title: profile.compliance.compliance_title, subtitle: profile.compliance.compliance_subtitle,
    },
    sustainability: profile.compliance.sustainability_statement,
    environmentalPrint: profile.compliance.environmental_print_statement,
    profileUrl: input.profileUrl,
  };
}
