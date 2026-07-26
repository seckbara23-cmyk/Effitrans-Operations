/**
 * Department handoff rules (Phase 2.1) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The four department-to-department handoffs and their static definitions, plus
 * the deterministic decision predicates (which the server triggers call after a
 * state change). No I/O — fully unit-tested. Handoff TASKS are derived
 * operational work items; the lifecycle tracker + dossier records remain the
 * source of truth.
 */
import { CUSTOMS_RANK, TRANSPORT_RANK, type Department } from "@/lib/files/lifecycle";

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

// ------------------------------------------- WES-1D: re-fire guard (PURE) ----

/**
 * The four handoffs in dossier order. A dossier that has reached a LATER
 * department has, by definition, surpassed every earlier handoff.
 */
export const HANDOFF_ORDER: readonly HandoffType[] = [
  "CUSTOMS_HANDOFF",
  "TRANSPORT_HANDOFF",
  "FINANCE_HANDOFF",
  "ARCHIVE_HANDOFF",
];

/**
 * What the dossier has actually reached. Read from the authoritative module
 * records — never from the handoff tasks themselves, which are the thing being
 * guarded.
 */
export type DossierProgress = {
  /** customs_record.status, or null when the dossier has no customs record. */
  customsStatus: string | null;
  /** transport_record.status, or null when there is no transport record. */
  transportStatus: string | null;
  /** At least one invoice exists that is neither DRAFT nor VOID. */
  hasIssuedInvoice: boolean;
  /** operational_file.status === "CLOSED". */
  fileClosed: boolean;
  /** Handoff types already carried to DONE for this dossier. */
  satisfiedTypes: readonly HandoffType[];
};

/**
 * Index into HANDOFF_ORDER of the furthest department the dossier has actually
 * reached; -1 when it has reached none of them.
 *
 * A department counts as REACHED only once it has genuinely started: a
 * NOT_STARTED (rank 0) customs or transport record is not "reached", so the
 * first legitimate handoff is never suppressed.
 */
export function reachedHandoffIndex(p: DossierProgress): number {
  let reached = -1;
  if ((CUSTOMS_RANK[p.customsStatus ?? "NOT_STARTED"] ?? 0) >= 1) reached = 0; // customs started
  if ((TRANSPORT_RANK[p.transportStatus ?? "NOT_STARTED"] ?? 0) >= 1) reached = Math.max(reached, 1);
  if (p.hasIssuedInvoice) reached = Math.max(reached, 2);
  if (p.fileClosed) reached = Math.max(reached, 3);
  return reached;
}

/**
 * WES-1D — may this handoff still be created?
 *
 * The audit's UAT defect: a customs handoff was completed, the dossier moved to
 * transport, then a POD document was approved late — `onDocumentApproved` fired
 * again and recreated « Dossier prêt pour déclaration douanière » on a dossier
 * already in transport. Checking only "no OPEN task exists" could not catch it,
 * because the original task was closed.
 *
 * A handoff is surpassed when EITHER an equivalent one has already been carried
 * to DONE, OR the dossier has already reached the target department (or a later
 * one). Monotonic by construction: a satisfied handoff never becomes eligible
 * again (ADR-WES-010).
 */
export function handoffSurpassed(type: HandoffType, p: DossierProgress): boolean {
  if (p.satisfiedTypes.includes(type)) return true;
  const target = HANDOFF_ORDER.indexOf(type);
  if (target < 0) return false;
  return reachedHandoffIndex(p) >= target;
}
