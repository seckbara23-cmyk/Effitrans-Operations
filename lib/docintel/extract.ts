/**
 * Document Intelligence — structured extraction (Phase 7.4A). PURE.
 * Two paths, both STRICT allowlist (a field key outside the class schema is REJECTED, never
 * stored): (1) `normalizeCandidateFields` — the contract any provider (manual/deterministic/
 * future LLM) feeds its raw output through; (2) `deterministicExtract` — a local extractor
 * over operator-provided text (no OCR, no AI). Document text is treated as untrusted DATA.
 */
import { schemaFor, isAllowedField, fieldSchema, type FieldSchema } from "./schemas";
import { normalizeField, validateFieldFormat } from "./validate";
import type { DocClass, Confidence, ValidationStatus } from "./types";

export type CandidateField = {
  fieldKey: string;
  displayedValue: string;
  normalizedValue: string | null;
  confidence: Confidence;
  page: number;
  evidence: string;
  validationStatus: ValidationStatus;
  method: string;
};

const EVIDENCE_MAX = 200;
const TEXT_MAX = 40_000;
// Control characters to strip (keep \t \n \r). Untrusted document content is DATA.
// eslint-disable-next-line no-control-regex
const CTRL = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]", "g");

/** Bound an evidence excerpt; collapse control chars + whitespace. Never markup/instruction. */
export function boundEvidence(s: string): string {
  return String(s ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, EVIDENCE_MAX);
}
/** Normalize + bound stored text (never a raw provider payload). Strips control chars. */
export function sanitizeText(text: string): string {
  return String(text ?? "").replace(CTRL, "").slice(0, TEXT_MAX);
}

function buildCandidate(f: FieldSchema, displayed: string, confidence: Confidence, evidence: string, method: string, page = 1): CandidateField {
  const normalized = normalizeField(f.kind, displayed);
  return { fieldKey: f.key, displayedValue: displayed.trim(), normalizedValue: normalized, confidence, page, evidence: boundEvidence(evidence), validationStatus: validateFieldFormat(f.kind, normalized), method };
}

/**
 * The structured-extraction CONTRACT. A provider returns `rawFields`; keys outside the class
 * schema are rejected (anti-invention), missing fields simply stay absent (null), and each
 * accepted field is normalized + validated. `confidences` (per key) are optional.
 */
export function normalizeCandidateFields(cls: DocClass, rawFields: Record<string, string>, method: string, confidences?: Record<string, Confidence>): { candidates: CandidateField[]; rejectedKeys: string[] } {
  const candidates: CandidateField[] = [];
  const rejectedKeys: string[] = [];
  for (const [key, value] of Object.entries(rawFields)) {
    if (!isAllowedField(cls, key)) { rejectedKeys.push(key); continue; }
    if (value == null || String(value).trim() === "") continue; // missing stays null
    const f = fieldSchema(cls, key)!;
    candidates.push(buildCandidate(f, String(value), confidences?.[key] ?? "MEDIUM", String(value), method));
  }
  return { candidates, rejectedKeys };
}

const CONTAINER_RE = /\b[A-Z]{4}\d{7}\b/g;
const AWB_RE = /\b\d{3}-?\d{8}\b/g;

function firstAfterLabel(lines: string[], keywords: string[]): { value: string; line: string } | null {
  for (const line of lines) {
    const low = line.toLowerCase();
    if (!keywords.some((k) => low.includes(k))) continue;
    const m = /[:：]\s*(.+)$/.exec(line);
    const value = (m ? m[1] : "").trim();
    if (value) return { value, line: line.trim() };
  }
  return null;
}

function keywordsFor(f: FieldSchema): string[] {
  const fromKey = f.key.split("_").filter((w) => w.length > 2);
  const fromLabel = f.labelFr.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 3);
  return Array.from(new Set([...fromKey, ...fromLabel]));
}

/**
 * Deterministic extraction over operator-provided text. No OCR, no AI. Token scanners for
 * container/AWB; label-based capture otherwise. Confidence is honest (MEDIUM for a labelled
 * match / token) — never HIGH (no model asserted it). STRICT to the schema.
 */
export function deterministicExtract(cls: DocClass, rawText: string, page = 1): CandidateField[] {
  const text = sanitizeText(rawText);
  const lines = text.split(/\r?\n/);
  const out: CandidateField[] = [];
  for (const f of schemaFor(cls)) {
    if (f.kind === "container") {
      const m = text.match(CONTAINER_RE);
      if (m && m[0]) out.push(buildCandidate(f, m[0], "MEDIUM", m[0], "deterministic", page));
      continue;
    }
    if (f.kind === "awb") {
      const m = text.match(AWB_RE);
      if (m && m[0]) out.push(buildCandidate(f, m[0], "MEDIUM", m[0], "deterministic", page));
      continue;
    }
    const found = firstAfterLabel(lines, keywordsFor(f));
    if (found) out.push(buildCandidate(f, found.value, "MEDIUM", found.line, "deterministic", page));
  }
  return out;
}

/**
 * Page-aware deterministic extraction (Phase 7.4B). Runs the extractor per page so each
 * candidate carries the PAGE it was found on (provenance). The FIRST page a field appears on
 * wins — later duplicates are ignored, so provenance is stable and single-valued.
 */
export function deterministicExtractPages(cls: DocClass, pages: string[]): CandidateField[] {
  const byKey = new Map<string, CandidateField>();
  pages.forEach((pageText, i) => {
    for (const c of deterministicExtract(cls, pageText, i + 1)) {
      if (!byKey.has(c.fieldKey)) byKey.set(c.fieldKey, c);
    }
  });
  return Array.from(byKey.values());
}
