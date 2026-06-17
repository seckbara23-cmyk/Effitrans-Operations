/**
 * Dossier lifecycle tracker (Phase 2.0 addendum) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Derives a 15-step lifecycle view from EXISTING records only (no new status
 * table, no mutation): operational_file.status, document completeness,
 * customs_record.status, transport_record.status, invoice/payment status and the
 * POD document. Read-only visualization. Fully unit-tested.
 *
 * Each step carries a stable `key` + `reasonCode` (the test contract) plus a
 * French `label`/`description`/`blocker` resolved from i18n (the UI contract).
 */
import { t } from "@/lib/i18n";

export type StepStatus = "completed" | "current" | "pending" | "blocked" | "skipped";
export type Department = "opening" | "documentation" | "customs" | "transport" | "finance" | "archive";

export type LifecycleStep = {
  key: string;
  label: string;
  department: Department;
  status: StepStatus;
  description: string;
  reasonCode?: string;
  detail?: string;
  blocker?: string;
  actionHref?: string;
};

export type LifecycleNextAction = {
  department: Department;
  stepKey: string;
  reasonCode: string;
  action: string;
  blocker?: string;
  href?: string;
};

export type DossierLifecycle = {
  steps: LifecycleStep[];
  currentStep: string | null;
  nextAction: LifecycleNextAction | null;
  blockers: { key: string; label: string; reason: string }[];
  completedPercent: number;
};

export type LifecycleInput = {
  fileId: string;
  file: { status: string; type: string };
  documents: { status: string }[];
  missingRequired: { label: string }[];
  customs: { status: string; required?: boolean } | null;
  transport: { status: string } | null;
  invoices: { status: string; balance: number }[];
  podApproved: boolean;
};

type RawStep = {
  key: string;
  department: Department;
  done: boolean;
  applicable: boolean;
  blockCode?: string; // hard blocker (only meaningful at the frontier)
  gateCode?: string; // waiting-on-upstream reason
  actionCode?: string; // what to do when this step is current
  detail?: string;
};

const ANCHOR: Record<Department, string> = {
  opening: "",
  documentation: "#documents",
  customs: "#customs",
  transport: "#transport",
  finance: "#finance",
  archive: "",
};

const CUSTOMS_RANK: Record<string, number> = {
  NOT_STARTED: 0,
  DOCUMENTS_PENDING: 1,
  DECLARATION_PREPARED: 2,
  DECLARED: 3,
  UNDER_REVIEW: 4,
  INSPECTION: 5,
  DUTIES_ASSESSED: 6,
  RELEASED: 7,
  BLOCKED: 0,
  CANCELLED: 0,
};

const TRANSPORT_RANK: Record<string, number> = {
  NOT_STARTED: 0,
  PLANNED: 1,
  DRIVER_ASSIGNED: 2,
  PICKED_UP: 3,
  IN_TRANSIT: 4,
  DELIVERED: 5,
  POD_RECEIVED: 6,
  BLOCKED: 0,
  CANCELLED: 0,
};

export function getDossierLifecycle(input: LifecycleInput): DossierLifecycle {
  const L = t.lifecycle;
  const { file } = input;
  const opened = file.status !== "DRAFT";
  const closed = file.status === "CLOSED";

  // ---- documents
  const approved = input.documents.filter((d) => d.status === "APPROVED").length;
  const pendingReview = input.documents.filter(
    (d) => d.status === "UPLOADED" || d.status === "PENDING_REVIEW",
  ).length;
  const missing = input.missingRequired.length;
  const docsCollected = missing === 0 || pendingReview > 0 || approved > 0;
  const docsVerified = missing === 0;
  const missingDetail = input.missingRequired.map((m) => m.label).join(", ");

  // ---- customs (IMP/EXP only; a record with required=false is skipped)
  const customsType = file.type === "IMP" || file.type === "EXP";
  const customsCancelled = input.customs?.status === "CANCELLED";
  const customsApplicable = customsType && input.customs?.required !== false && !customsCancelled;
  const cStatus = input.customs?.status ?? "NOT_STARTED";
  const cRank = CUSTOMS_RANK[cStatus] ?? 0;
  const customsBlocked = cStatus === "BLOCKED";
  const customsReleased = cStatus === "RELEASED";

  // ---- transport (always part of a shipment unless cancelled)
  const transportCancelled = input.transport?.status === "CANCELLED";
  const transportApplicable = !transportCancelled;
  const tStatus = input.transport?.status ?? "NOT_STARTED";
  const tRank = TRANSPORT_RANK[tStatus] ?? 0;
  const transportBlocked = tStatus === "BLOCKED";

  // ---- finance
  const issued = input.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
  const hasIssued = issued.length > 0;
  const paidDone = hasIssued && issued.every((i) => i.status === "PAID");

  const raw: RawStep[] = [
    { key: "draft", department: "opening", applicable: true, done: opened, actionCode: "approve_quote" },
    { key: "quote_approved", department: "opening", applicable: true, done: opened, actionCode: "approve_quote" },
    {
      key: "documents_collection",
      department: "documentation",
      applicable: true,
      done: docsCollected,
      blockCode: !docsCollected && missing > 0 && opened ? "docs_missing" : undefined,
      detail: !docsCollected && missing > 0 ? missingDetail : undefined,
      actionCode: "collect_docs",
    },
    {
      key: "documents_verified",
      department: "documentation",
      applicable: true,
      done: docsVerified,
      actionCode: pendingReview > 0 ? "docs_pending_review" : "collect_docs",
      detail: missing > 0 ? missingDetail : undefined,
    },
    {
      key: "customs_preparation",
      department: "customs",
      applicable: customsApplicable,
      done: customsApplicable ? cRank >= 2 : false,
      blockCode: customsBlocked ? "customs_blocked" : undefined,
      gateCode: !docsVerified ? "docs_must_verify" : undefined,
      actionCode: "declare",
    },
    {
      key: "customs_declaration",
      department: "customs",
      applicable: customsApplicable,
      done: customsApplicable ? cRank >= 3 : false,
      gateCode: !docsVerified ? "docs_must_verify" : undefined,
      actionCode: "declare",
    },
    {
      key: "customs_inspection",
      department: "customs",
      applicable: customsApplicable,
      done: customsApplicable ? cRank >= 6 : false,
      actionCode: "await_customs_response",
    },
    {
      key: "customs_cleared",
      department: "customs",
      applicable: customsApplicable,
      done: customsApplicable ? cRank >= 6 : false,
      actionCode: "await_customs_response",
    },
    {
      key: "release_authorized",
      department: "customs",
      applicable: customsApplicable,
      done: customsApplicable ? cRank >= 7 : false,
      actionCode: "release",
    },
    {
      key: "transport_planned",
      department: "transport",
      applicable: transportApplicable,
      done: transportApplicable ? tRank >= 3 : false,
      blockCode: transportBlocked ? "transport_blocked" : undefined,
      gateCode: customsApplicable && !customsReleased ? "await_customs_release" : undefined,
      actionCode: "plan_transport",
    },
    {
      key: "in_transit",
      department: "transport",
      applicable: transportApplicable,
      done: transportApplicable ? tRank >= 4 : false,
      actionCode: "start_transit",
    },
    {
      key: "delivered",
      department: "transport",
      applicable: transportApplicable,
      done: transportApplicable ? tRank >= 5 : false,
      actionCode: "mark_delivered",
    },
    {
      key: "invoiced",
      department: "finance",
      applicable: true,
      done: hasIssued,
      gateCode: !input.podApproved ? "await_pod" : undefined,
      actionCode: "issue_invoice",
    },
    {
      key: "paid",
      department: "finance",
      applicable: true,
      done: paidDone,
      actionCode: "record_payment",
    },
    {
      key: "archived",
      department: "archive",
      applicable: true,
      done: closed,
      gateCode: !paidDone ? "await_payment" : undefined,
      actionCode: "close_dossier",
    },
  ];

  const reason = (code?: string, detail?: string) => {
    if (!code) return "";
    const base = (L.reasons as Record<string, string>)[code] ?? code;
    return detail ? `${base} : ${detail}` : base;
  };
  const stepLabel = (key: string) => (L.steps as Record<string, string>)[key] ?? key;

  let frontierSeen = false;
  const steps: LifecycleStep[] = raw.map((r) => {
    let status: StepStatus;
    if (!r.applicable) status = "skipped";
    else if (r.done) status = "completed";
    else if (!frontierSeen) {
      frontierSeen = true;
      status = r.blockCode ? "blocked" : "current";
    } else status = "pending";

    const href = r.applicable ? `/files/${input.fileId}${ANCHOR[r.department]}` : undefined;
    let description: string;
    if (status === "completed") description = L.status.completed;
    else if (status === "skipped") description = L.status.skipped;
    else if (status === "blocked") description = reason(r.blockCode, r.detail);
    else if (status === "current") description = reason(r.gateCode ?? r.actionCode, r.detail) || L.reasons.in_progress;
    else description = r.gateCode ? reason(r.gateCode, r.detail) : L.status.pending;

    return {
      key: r.key,
      label: stepLabel(r.key),
      department: r.department,
      status,
      description,
      reasonCode: status === "blocked" ? r.blockCode : status === "current" || (status === "pending" && r.gateCode) ? r.gateCode ?? r.actionCode : undefined,
      detail: r.detail,
      blocker: status === "blocked" ? reason(r.blockCode, r.detail) : undefined,
      actionHref: href,
    };
  });

  const applicable = steps.filter((s) => s.status !== "skipped");
  const completed = applicable.filter((s) => s.status === "completed").length;
  const completedPercent = applicable.length === 0 ? 0 : Math.round((completed / applicable.length) * 100);

  const frontier = steps.find((s) => s.status === "current" || s.status === "blocked") ?? null;
  const currentStep = frontier ? frontier.key : null;

  const blockers = steps
    .filter((s) => s.status === "blocked")
    .map((s) => ({ key: s.key, label: s.label, reason: s.blocker ?? "" }));

  const nextAction: LifecycleNextAction | null = frontier
    ? {
        department: frontier.department,
        stepKey: frontier.key,
        reasonCode: frontier.reasonCode ?? "in_progress",
        action: frontier.status === "blocked" ? (frontier.blocker ?? "") : frontier.description,
        blocker: frontier.status === "blocked" ? frontier.blocker : undefined,
        href: frontier.actionHref,
      }
    : null;

  return { steps, currentStep, nextAction, blockers, completedPercent };
}
