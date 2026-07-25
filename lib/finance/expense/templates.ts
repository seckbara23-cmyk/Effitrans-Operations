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
 * Immutable versioned template metadata. `checksum` and `pageCount` are filled
 * when the source asset is committed (11.0C). Coordinate maps (field + visa box
 * positions) are added by 11.0C alongside the raster — deliberately absent here.
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
};

/**
 * The code-managed registry. EMPTY in 11.0B — versions are registered when the
 * master template PDF is committed (11.0C). Never mutate a published entry: a
 * new template revision is a NEW version row (immutable, DEC-C13/C24).
 */
export const EXPENSE_TEMPLATES: readonly ExpenseTemplateVersion[] = [];

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
