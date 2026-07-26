/**
 * Canonical dossier stage ladder (Phase WES-2) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * THE ordered stages a dossier passes through, and the only ordering the
 * platform recognises:
 *
 *   Draft → Ouvert → Documentation → Douane → Transport → Finance → Archivage
 *
 * This is the ladder ADR-WES-010's ratchet runs on. It is deliberately the
 * DEPARTMENT-level ladder, not the 26-step process registry and not the 15-step
 * dossier tracker: those are DETAIL views of the same journey, and both remain
 * available. What was missing was a single, coarse, totally-ordered spine that
 * every surface can agree on — "where is this dossier?" has exactly one answer,
 * and that answer can only move forward.
 *
 * Reuses the existing `Department` vocabulary (lib/files/lifecycle.ts) rather
 * than inventing a second set of department names.
 */
import type { Department } from "@/lib/files/lifecycle";

export type CanonicalStageKey =
  | "draft"
  | "open"
  | "documentation"
  | "customs"
  | "transport"
  | "finance"
  | "archive";

export type CanonicalStageDef = {
  key: CanonicalStageKey;
  /** Position in the ladder. Strictly increasing; the ratchet compares these. */
  ordinal: number;
  labelFr: string;
  /**
   * The department whose work this stage represents. `draft` and `open` are both
   * the opening department: leaving draft IS being open.
   */
  department: Department;
};

export const CANONICAL_STAGES: readonly CanonicalStageDef[] = [
  { key: "draft", ordinal: 0, labelFr: "Brouillon", department: "opening" },
  { key: "open", ordinal: 1, labelFr: "Ouvert", department: "opening" },
  { key: "documentation", ordinal: 2, labelFr: "Documentation", department: "documentation" },
  { key: "customs", ordinal: 3, labelFr: "Douane", department: "customs" },
  { key: "transport", ordinal: 4, labelFr: "Transport", department: "transport" },
  { key: "finance", ordinal: 5, labelFr: "Finance", department: "finance" },
  { key: "archive", ordinal: 6, labelFr: "Archivage", department: "archive" },
] as const;

const BY_KEY = new Map(CANONICAL_STAGES.map((s) => [s.key, s]));

export function stageOrdinal(key: CanonicalStageKey): number {
  return BY_KEY.get(key)?.ordinal ?? 0;
}

export function stageByOrdinal(ordinal: number): CanonicalStageDef {
  const clamped = Math.max(0, Math.min(ordinal, CANONICAL_STAGES.length - 1));
  return CANONICAL_STAGES[clamped];
}

/**
 * The stage a department's work ENTERS at — its first stage on the ladder.
 *
 * `opening` therefore maps to `draft`, not `open`: a dossier whose frontier is
 * still in the opening department has not finished being a draft, and reporting
 * it as `open` would credit it with a stage it has not completed. The ratchet
 * raises it to `open` separately, from the evidence that it left DRAFT.
 */
export function stageForDepartment(department: Department): CanonicalStageDef {
  const match = CANONICAL_STAGES.find((s) => s.department === department);
  return match ?? CANONICAL_STAGES[0];
}

/** Structural self-check used by the tests: the ladder is totally ordered, no gaps. */
export function ladderIsWellFormed(): boolean {
  return CANONICAL_STAGES.every((s, i) => s.ordinal === i);
}
