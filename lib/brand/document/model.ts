/**
 * Corporate document model (DBC-4). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * ONE reusable model for every branded document (Letterhead / Quotation / Invoice /
 * Proposal, and future types). Branding is resolved ONCE from the Brand Center and injected
 * here — no renderer duplicates brand values. The PDF + DOCX renderers both consume this.
 *
 * The reused PDF engine (lib/reports/pdf.ts) has no raster-image support, so the "logo" is
 * the branded header (brand colour band + company wordmark), exactly as the report engine
 * does — raster-logo embedding is deferred with engine image support.
 */
import type { BrandProfile, BrandAssetView, MembershipView } from "@/lib/brand/server/service";

export const DOCUMENT_TYPES = ["LETTERHEAD", "QUOTATION", "INVOICE", "PROPOSAL"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(v: string): v is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(v);
}

export type DocLineItem = { description: string; quantity: number; unitPrice: number };
export type DocSection = { heading: string; text: string };
export type DocSignature = { name: string; title: string | null; email: string; phone: string | null } | null;

export type DocumentBrand = {
  companyName: string;
  slogan: string | null;
  green: string; gold: string | null; anthracite: string;
  address: string | null;
  legalIdentifiers: string | null;
  footer: string;
  memberships: string[]; // ACTIVE, ordered, names (approved logos are image-only → names in docs)
  compliance: { title: string; subtitle: string; buttonLabel: string; portalUrl: string } | null;
  sustainability: string;
  environmentalPrint: string;
};

export type CorporateDocumentModel = {
  type: DocumentType;
  meta: { title: string; number: string | null; date: string; reference: string | null };
  brand: DocumentBrand;
  client: { name: string; address: string | null } | null;
  body: { paragraphs?: string[]; lines?: DocLineItem[]; currency?: string; sections?: DocSection[]; notes?: string | null };
  signature: DocSignature;
};

export type DocumentReadiness = { ready: boolean; missing: string[] };

/** Documents publish only with the visible brand identity present (colour + address). */
export function documentReadiness(profile: BrandProfile): DocumentReadiness {
  const missing: string[] = [];
  if (!profile.colorGreen) missing.push("Couleur verte officielle");
  if (!profile.address) missing.push("Adresse de l'entreprise");
  return { ready: missing.length === 0, missing };
}

/** Line-item total (deterministic, integer-cent safe enough for display). */
export function lineTotal(l: DocLineItem): number {
  return Math.round(l.quantity * l.unitPrice * 100) / 100;
}
export function documentTotals(lines: DocLineItem[]): { subtotal: number } {
  return { subtotal: Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100 };
}

export type DocumentInput = {
  type: DocumentType;
  title: string;
  number?: string | null;
  date: string;
  reference?: string | null;
  client?: { name: string; address?: string | null } | null;
  paragraphs?: string[];
  lines?: DocLineItem[];
  currency?: string;
  sections?: DocSection[];
  notes?: string | null;
};

/** Assemble the model from resolved Brand Center data + the caller's document input. */
export function buildDocumentModel(input: {
  doc: DocumentInput;
  companyName: string;
  profile: BrandProfile;
  memberships: MembershipView[];
  signature: DocSignature;
  complianceEnabled: boolean;
}): CorporateDocumentModel {
  const { doc, profile } = input;
  const activeMemberships = input.memberships
    .filter((m) => m.status === "active")
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => m.organizationName);

  return {
    type: doc.type,
    meta: { title: doc.title, number: doc.number ?? null, date: doc.date, reference: doc.reference ?? null },
    brand: {
      companyName: input.companyName,
      slogan: profile.slogan,
      green: profile.colorGreen ?? "#0F766E",
      gold: profile.colorGold,
      anthracite: profile.colorAnthracite ?? "#333F48",
      address: profile.address,
      legalIdentifiers: profile.legalIdentifiers,
      footer: profile.compliance.footer_line,
      memberships: activeMemberships,
      compliance: input.complianceEnabled && profile.whistleblowerUrl
        ? { title: profile.compliance.compliance_title, subtitle: profile.compliance.compliance_subtitle, buttonLabel: profile.compliance.compliance_button_label, portalUrl: profile.whistleblowerUrl }
        : null,
      sustainability: profile.compliance.sustainability_statement,
      environmentalPrint: profile.compliance.environmental_print_statement,
    },
    client: doc.client ? { name: doc.client.name, address: doc.client.address ?? null } : null,
    body: { paragraphs: doc.paragraphs, lines: doc.lines, currency: doc.currency, sections: doc.sections, notes: doc.notes ?? null },
    signature: input.signature,
  };
}

/** `#rgb`/`#rrggbb` → PDF RGB tuple [0..1]. Falls back to a safe green on bad input. */
export function hexToRgb(hex: string | null): [number, number, number] {
  const fb: [number, number, number] = [0.06, 0.46, 0.43];
  if (!hex) return fb;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fb;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
