/**
 * Stage duration engine (Phase 2.3) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Derives "time in current stage" from EXISTING timestamps — no new tables, no
 * stored values. `enteredAt` is the best available proxy for when the dossier
 * entered its current department: the governing record's last-updated timestamp
 * (or the dossier's opened/created time), with a fallback chain that always ends
 * at fileCreatedAt. This is a derived approximation (documented), not a tracked
 * stage-entry event.
 */
import type { Department } from "@/lib/files/lifecycle";

export type StageDuration = {
  currentDepartment: Department | null;
  currentStage: string | null;
  enteredAt: string | null;
  ageHours: number;
  ageDays: number;
};

export type StageDurationInput = {
  now: Date;
  currentDepartment: Department | null;
  currentStage: string | null;
  fileCreatedAt: string;
  fileOpenedAt: string | null;
  fileUpdatedAt: string | null;
  customsUpdatedAt: string | null;
  transportUpdatedAt: string | null;
  invoiceUpdatedAt: string | null;
};

function firstPresent(...values: (string | null | undefined)[]): string | null {
  for (const v of values) if (v) return v;
  return null;
}

/** Best-available "entered current stage" timestamp for the dossier's department. */
function resolveEnteredAt(i: StageDurationInput): string | null {
  switch (i.currentDepartment) {
    case "opening":
      return i.fileCreatedAt;
    case "documentation":
      return firstPresent(i.fileOpenedAt, i.fileCreatedAt);
    case "customs":
      return firstPresent(i.customsUpdatedAt, i.fileOpenedAt, i.fileCreatedAt);
    case "transport":
      return firstPresent(i.transportUpdatedAt, i.fileOpenedAt, i.fileCreatedAt);
    case "finance":
      return firstPresent(i.invoiceUpdatedAt, i.fileOpenedAt, i.fileCreatedAt);
    case "archive":
      return firstPresent(i.fileUpdatedAt, i.fileCreatedAt);
    default:
      return firstPresent(i.fileUpdatedAt, i.fileCreatedAt);
  }
}

export function stageDuration(i: StageDurationInput): StageDuration {
  const enteredAt = resolveEnteredAt(i);
  const entered = enteredAt ? new Date(enteredAt).getTime() : NaN;
  const ms = Number.isNaN(entered) ? 0 : Math.max(0, i.now.getTime() - entered);
  return {
    currentDepartment: i.currentDepartment,
    currentStage: i.currentStage,
    enteredAt,
    ageHours: Math.round((ms / 3_600_000) * 10) / 10,
    ageDays: Math.floor(ms / 86_400_000),
  };
}
