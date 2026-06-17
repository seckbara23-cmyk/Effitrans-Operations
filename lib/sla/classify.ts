/**
 * SLA classification (Phase 2.3) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Maps (department, hours-in-stage) → normal | warning | critical |
 * informational, using the code-based thresholds. Boundaries are inclusive
 * (>= warning → warning, >= critical → critical).
 */
import type { Department } from "@/lib/files/lifecycle";
import { SLA_THRESHOLDS, type SlaDept } from "./config";

export type SlaStatus = "normal" | "warning" | "critical" | "informational";

/** A lifecycle Department narrowed to an SLA department (opening has no SLA). */
export function toSlaDept(department: Department | null): SlaDept | null {
  if (department === "documentation" || department === "customs" || department === "transport" || department === "finance" || department === "archive") {
    return department;
  }
  return null; // opening / null → no SLA
}

export function classifySla(department: Department | null, ageHours: number): SlaStatus {
  const dept = toSlaDept(department);
  if (!dept) return "normal";
  const th = SLA_THRESHOLDS[dept];
  if (!th) return "informational"; // archive
  if (ageHours >= th.criticalHours) return "critical";
  if (ageHours >= th.warningHours) return "warning";
  return "normal";
}
