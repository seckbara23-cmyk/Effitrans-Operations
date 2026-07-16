/**
 * Presentation + communication registries (DBC-5). PURE.
 * ---------------------------------------------------------------------------
 * The catalogs. CORPORATE is the only active presentation type; EXECUTIVE/SALES/TRAINING
 * plug in later. Slide + communication types are shared so renderers never duplicate a
 * layout.
 */
export const PRESENTATION_TYPES = ["CORPORATE", "EXECUTIVE", "SALES", "TRAINING"] as const;
export type PresentationType = (typeof PRESENTATION_TYPES)[number];
export const ACTIVE_PRESENTATIONS: PresentationType[] = ["CORPORATE"];
export function isPresentationType(v: string): v is PresentationType {
  return (PRESENTATION_TYPES as readonly string[]).includes(v);
}

export const SLIDE_TYPES = [
  "TITLE", "AGENDA", "SECTION", "CONTENT", "IMAGE", "TABLE", "CHART", "TIMELINE", "QUOTE", "THANK_YOU",
] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];

export const COMMUNICATION_KINDS = ["COMPANY_BANNER", "CEO_BANNER", "PUBLICATION", "ANNOUNCEMENT"] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];
export function isCommunicationKind(v: string): v is CommunicationKind {
  return (COMMUNICATION_KINDS as readonly string[]).includes(v);
}

export const COMMUNICATION_META: Record<CommunicationKind, { label: string; width: number; height: number }> = {
  COMPANY_BANNER: { label: "Bannière entreprise (LinkedIn)", width: 1128, height: 191 },
  CEO_BANNER: { label: "Bannière dirigeant (LinkedIn)", width: 1584, height: 396 },
  PUBLICATION: { label: "Publication (carré)", width: 1200, height: 1200 },
  ANNOUNCEMENT: { label: "Annonce", width: 1200, height: 627 },
};
