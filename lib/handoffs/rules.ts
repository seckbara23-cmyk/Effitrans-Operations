/**
 * Department handoff rules (Phase 2.1) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The four department-to-department handoffs and their static definitions, plus
 * the deterministic decision predicates (which the server triggers call after a
 * state change). No I/O — fully unit-tested. Handoff TASKS are derived
 * operational work items; the lifecycle tracker + dossier records remain the
 * source of truth.
 */
import type { Department } from "@/lib/files/lifecycle";

export type HandoffType = "CUSTOMS_HANDOFF" | "TRANSPORT_HANDOFF" | "FINANCE_HANDOFF" | "ARCHIVE_HANDOFF";

export type HandoffDef = {
  type: HandoffType;
  source: Department;
  target: Department;
  /** Role expected to action the handoff (assignment stays unset; surfaced via the dept dashboard). */
  role: string;
  /** i18n key under t.handoffs.titles */
  titleKey: HandoffType;
};

export const HANDOFFS: Record<HandoffType, HandoffDef> = {
  CUSTOMS_HANDOFF: { type: "CUSTOMS_HANDOFF", source: "documentation", target: "customs", role: "CUSTOMS_DECLARANT", titleKey: "CUSTOMS_HANDOFF" },
  TRANSPORT_HANDOFF: { type: "TRANSPORT_HANDOFF", source: "customs", target: "transport", role: "TRANSPORT_OFFICER", titleKey: "TRANSPORT_HANDOFF" },
  FINANCE_HANDOFF: { type: "FINANCE_HANDOFF", source: "transport", target: "finance", role: "FINANCE_OFFICER", titleKey: "FINANCE_HANDOFF" },
  ARCHIVE_HANDOFF: { type: "ARCHIVE_HANDOFF", source: "finance", target: "archive", role: "OPS_SUPERVISOR", titleKey: "ARCHIVE_HANDOFF" },
};

export const HANDOFF_TYPES = Object.keys(HANDOFFS) as HandoffType[];

export function isHandoffType(v: string): v is HandoffType {
  return (HANDOFF_TYPES as string[]).includes(v);
}

// --------------------------------------------------------------- decisions ----

/** Documentation → Customs precondition: all required doc types are APPROVED. */
export function documentationComplete(requiredCodes: string[], approvedTypeCodes: string[]): boolean {
  if (requiredCodes.length === 0) return false; // nothing required => no auto-handoff
  const approved = new Set(approvedTypeCodes);
  return requiredCodes.every((c) => approved.has(c));
}

/** Finance → Archive precondition: the dossier has issued invoices and none owe a balance. */
export function dossierFullyPaid(invoices: { status: string; balance: number }[]): boolean {
  const issued = invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
  return issued.length > 0 && issued.every((i) => i.balance <= 0);
}
