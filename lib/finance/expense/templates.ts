/**
 * Finance Expense Documents — template registry (Phase 11.0B). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The two documents render against EXACT reproductions of the paper templates
 * (DEC-C16: original-page raster background + coordinate overlays). Per 11.0A
 * §10, the FIRST-RELEASE registry is CODE-MANAGED immutable metadata (the master
 * template PDF is not yet in the repo — an 11.0C prerequisite), mirrored by the
 * global `expense_template` catalog table for DB-level provenance.
 *
 * This module declares the two template CODES and the versioned-metadata
 * CONTRACT that 11.0C consumes when the master asset lands. It ships with NO
 * concrete versions and performs NO rendering (that is 11.0C/D).
 */

import { EXPENSE_DOCUMENT_TYPES, type ExpenseDocumentType } from "./types";
import { AUTHORIZATION_GEOMETRY } from "./template-map";

export const EXPENSE_TEMPLATE_CODES = ["EXPENSE_AUTHORIZATION", "EXPENSE_VOUCHER"] as const;
export type ExpenseTemplateCode = (typeof EXPENSE_TEMPLATE_CODES)[number];

export function isExpenseTemplateCode(v: string): v is ExpenseTemplateCode {
  return (EXPENSE_TEMPLATE_CODES as readonly string[]).includes(v);
}

/** A template code is 1:1 with a document type (same identifier). */
export function templateCodeForDocument(docType: ExpenseDocumentType): ExpenseTemplateCode {
  return docType; // the two vocabularies are intentionally identical
}

export const EXPENSE_TEMPLATE_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type ExpenseTemplateStatus = (typeof EXPENSE_TEMPLATE_STATUSES)[number];

/**
 * The DEC-C16 raster background: the scanned master page(s) of the original
 * paper form, drawn full-bleed under the value overlays. `null` while the master
 * asset is not in the repository — see the conflict record in
 * docs/finance/phase-11.0c-expense-authorization.md.
 *
 * Registering one is the ONLY change needed to switch a template from the
 * drawn-chrome stand-in to the true original: the coordinate map is unchanged,
 * so no value moves (lib/finance/expense/template-map.ts).
 */
export type ExpenseTemplateBackground = {
  /** Repo-relative path of each page raster, page 1 first (baseline JPEG). */
  pages: readonly string[];
  /** sha256 of the master source asset the rasters were produced from. */
  checksum: string;
};

/**
 * Immutable versioned template metadata. `checksum`/`background` are filled when
 * the source asset is committed; `geometry` is the 11.0C coordinate map (field +
 * visa-box positions) the renderer draws against.
 */
export type ExpenseTemplateVersion = {
  code: ExpenseTemplateCode;
  version: number;
  /** sha256 of the source template asset — null until the asset lands. */
  checksum: string | null;
  pageCount: number | null;
  status: ExpenseTemplateStatus;
  activeFrom: string | null;
  retiredAt: string | null;
  /** DEC-C16 layer 1. null ⇒ the renderer draws the form chrome instead. */
  background: ExpenseTemplateBackground | null;
};

/**
 * The code-managed registry (11.0A §10 — the platform's registry idiom: process
 * steps, queues and codes are all code constants).
 *
 * EXPENSE_AUTHORIZATION v1 is registered in 11.0C with its coordinate geometry
 * and a NULL background — the master raster is still outstanding. EXPENSE_VOUCHER
 * stays unregistered until 11.0D.
 *
 * Never mutate a published entry: a new template revision is a NEW version entry
 * (immutable, DEC-C13/C24), so previously rendered documents stay reproducible.
 */
export const EXPENSE_TEMPLATES: readonly ExpenseTemplateVersion[] = [
  {
    code: "EXPENSE_AUTHORIZATION",
    version: 1,
    checksum: null,
    pageCount: 1,
    status: "ACTIVE",
    activeFrom: "2026-07-26",
    retiredAt: null,
    background: null,
  },
];

/** The coordinate geometry a template version renders against. */
export function templateGeometry(code: ExpenseTemplateCode): typeof AUTHORIZATION_GEOMETRY | null {
  return code === "EXPENSE_AUTHORIZATION" ? AUTHORIZATION_GEOMETRY : null;
}

/** The current ACTIVE version for a template code, or null if none is registered. */
export function activeTemplateVersion(code: ExpenseTemplateCode): ExpenseTemplateVersion | null {
  return EXPENSE_TEMPLATES.find((t) => t.code === code && t.status === "ACTIVE") ?? null;
}

/** Structural sanity: exactly the two document types have a template code. */
export function templateCodesCoverDocuments(): boolean {
  return (
    EXPENSE_TEMPLATE_CODES.length === EXPENSE_DOCUMENT_TYPES.length &&
    EXPENSE_DOCUMENT_TYPES.every((d) => isExpenseTemplateCode(d))
  );
}
