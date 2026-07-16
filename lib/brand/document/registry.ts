/**
 * Corporate document template registry (DBC-4). PURE.
 * ---------------------------------------------------------------------------
 * The catalog of document templates. Four are active; future types (delivery note, packing
 * list, certificates, customs, AI-generated) plug in here by adding an entry + a body shape
 * the shared renderers already understand — no new generator, no forked branding.
 */
import type { DocumentType } from "./model";

export type BodyShape = "paragraphs" | "line_items" | "sections";

export type DocumentTemplate = {
  type: DocumentType;
  label: string;
  /** Which body the studio form collects + the renderers lay out. */
  shape: BodyShape;
  /** Whether a client/recipient block applies. */
  hasClient: boolean;
  /** Whether a signature block may be appended. */
  allowsSignature: boolean;
};

export const TEMPLATE_REGISTRY: Record<DocumentType, DocumentTemplate> = {
  LETTERHEAD: { type: "LETTERHEAD", label: "Papier à en-tête", shape: "paragraphs", hasClient: true, allowsSignature: true },
  QUOTATION: { type: "QUOTATION", label: "Devis", shape: "line_items", hasClient: true, allowsSignature: true },
  INVOICE: { type: "INVOICE", label: "Facture", shape: "line_items", hasClient: true, allowsSignature: false },
  PROPOSAL: { type: "PROPOSAL", label: "Proposition commerciale", shape: "sections", hasClient: true, allowsSignature: true },
};

export const TEMPLATE_LIST: DocumentTemplate[] = Object.values(TEMPLATE_REGISTRY);
