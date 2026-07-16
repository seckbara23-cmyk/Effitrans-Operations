/**
 * Presentation + communication model (DBC-5). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * ONE model for the corporate deck and one for LinkedIn/social masters. Branding is
 * resolved once from the Brand Center and injected — no renderer duplicates brand values.
 * Readiness gates on the visible brand identity (green + address), like documents.
 */
import type { BrandProfile, MembershipView } from "@/lib/brand/server/service";
import type { PresentationType, CommunicationKind } from "./registry";

export type DeckBrand = {
  companyName: string; slogan: string | null;
  green: string; gold: string; anthracite: string;
  footer: string; memberships: string[];
};

export type Slide =
  | { type: "TITLE"; title: string; subtitle: string | null }
  | { type: "SECTION"; title: string }
  | { type: "AGENDA"; title: string; items: string[] }
  | { type: "CONTENT"; title: string; bullets: string[] }
  | { type: "IMAGE"; title: string; caption: string | null }
  | { type: "TABLE"; title: string; headers: string[]; rows: string[][] }
  | { type: "CHART"; title: string; data: { label: string; value: number }[] }
  | { type: "TIMELINE"; title: string; milestones: { label: string; when: string }[] }
  | { type: "QUOTE"; quote: string; author: string | null }
  | { type: "THANK_YOU"; title: string; subtitle: string | null };

export type Deck = { presentationType: PresentationType; brand: DeckBrand; slides: Slide[] };

export type DeckReadiness = { ready: boolean; missing: string[] };
export function presentationReadiness(profile: BrandProfile): DeckReadiness {
  const missing: string[] = [];
  if (!profile.colorGreen) missing.push("Couleur verte officielle");
  if (!profile.address) missing.push("Adresse de l'entreprise");
  return { ready: missing.length === 0, missing };
}

function deckBrand(companyName: string, profile: BrandProfile, memberships: MembershipView[]): DeckBrand {
  return {
    companyName,
    slogan: profile.slogan,
    green: profile.colorGreen ?? "#0F766E",
    gold: profile.colorGold ?? "#C8A24B",
    anthracite: profile.colorAnthracite ?? "#333F48",
    footer: profile.compliance.footer_line,
    memberships: memberships.filter((m) => m.status === "active").sort((a, b) => a.displayOrder - b.displayOrder).map((m) => m.organizationName),
  };
}

export type DeckInput = {
  presentationType: PresentationType;
  title: string;
  subtitle?: string | null;
  presenter?: string | null;
  agenda?: string[];
  sections?: { title: string; bullets: string[] }[];
};

/** A complete, editable CORPORATE deck (Cover, Agenda, Section+Content per section, Table,
 *  Chart, Closing) branded from the Brand Center — a starting master the user edits. */
export function buildCorporateDeck(input: {
  deck: DeckInput; companyName: string; profile: BrandProfile; memberships: MembershipView[];
}): Deck {
  const brand = deckBrand(input.companyName, input.profile, input.memberships);
  const d = input.deck;
  const slides: Slide[] = [];

  slides.push({ type: "TITLE", title: d.title, subtitle: d.subtitle ?? d.presenter ?? brand.slogan });
  if (d.agenda?.length) slides.push({ type: "AGENDA", title: "Ordre du jour", items: d.agenda });

  const sections = d.sections?.length ? d.sections : [{ title: "Présentation", bullets: ["Point clé 1", "Point clé 2", "Point clé 3"] }];
  for (const s of sections) {
    slides.push({ type: "SECTION", title: s.title });
    slides.push({ type: "CONTENT", title: s.title, bullets: s.bullets.length ? s.bullets : ["…"] });
  }

  // A table + a simple chart master (data placeholders the user edits).
  slides.push({ type: "TABLE", title: "Indicateurs", headers: ["Indicateur", "Valeur"], rows: [["À compléter", "—"], ["À compléter", "—"]] });
  slides.push({ type: "CHART", title: "Évolution", data: [{ label: "T1", value: 0 }, { label: "T2", value: 0 }, { label: "T3", value: 0 }] });

  slides.push({ type: "THANK_YOU", title: "Merci", subtitle: brand.companyName });
  return { presentationType: d.presentationType, brand, slides };
}

// ---------------------------------------------------------------- communication ----

export type CommunicationBrand = { companyName: string; slogan: string | null; green: string; gold: string; anthracite: string; footer: string };

export type CommunicationModel = {
  kind: CommunicationKind;
  width: number; height: number;
  brand: CommunicationBrand;
  headline: string;
  subline: string | null;
  /** CEO banner: person name + title. */
  person: { name: string; title: string | null } | null;
};

export function buildCommunicationModel(input: {
  kind: CommunicationKind; width: number; height: number;
  companyName: string; profile: BrandProfile;
  headline: string; subline?: string | null; person?: { name: string; title: string | null } | null;
}): CommunicationModel {
  return {
    kind: input.kind, width: input.width, height: input.height,
    brand: {
      companyName: input.companyName, slogan: input.profile.slogan,
      green: input.profile.colorGreen ?? "#0F766E", gold: input.profile.colorGold ?? "#C8A24B",
      anthracite: input.profile.colorAnthracite ?? "#333F48", footer: input.profile.compliance.footer_line,
    },
    headline: input.headline,
    subline: input.subline ?? null,
    person: input.person ?? null,
  };
}
