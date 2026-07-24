/**
 * Portal progress mapping (Phase 2.4) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Maps the INTERNAL lifecycle (getDossierLifecycle steps) to a simplified,
 * customer-facing 10-stage timeline. Single source of truth — no second
 * lifecycle, no portal status fields. Deliberately drops internal language,
 * departments, blockers, SLA and inspection detail: stages are only
 * completed / current / pending (never blocked). Labels are resolved in the UI
 * via i18n (this returns stable keys), so no internal copy leaks.
 */
import { isActiveFileStatus, isFileStatus } from "@/lib/files/status";

export type PortalStageStatus = "completed" | "current" | "pending";
export type PortalStageKey =
  | "created"
  | "documents_received"
  | "documents_verified"
  | "customs_in_progress"
  | "customs_done"
  | "transport_planned"
  | "in_transit"
  | "delivered"
  | "invoiced"
  | "paid";

export type PortalStage = { key: PortalStageKey; status: PortalStageStatus };

export type PortalTimeline = {
  stages: PortalStage[];
  currentKey: PortalStageKey | null;
  nextKey: PortalStageKey | null;
  percent: number;
};

// Customer stage -> the INTERNAL lifecycle step whose completion marks it done.
// `null` = always done (the dossier exists). skipped internal steps count as done
// so the customer timeline still flows (e.g. non-customs shipments).
const STAGE_DEFS: { key: PortalStageKey; doneKey: string | null }[] = [
  { key: "created", doneKey: null },
  { key: "documents_received", doneKey: "documents_collection" },
  { key: "documents_verified", doneKey: "documents_verified" },
  { key: "customs_in_progress", doneKey: "customs_cleared" },
  { key: "customs_done", doneKey: "release_authorized" },
  { key: "transport_planned", doneKey: "transport_planned" },
  { key: "in_transit", doneKey: "in_transit" },
  { key: "delivered", doneKey: "delivered" },
  { key: "invoiced", doneKey: "invoiced" },
  { key: "paid", doneKey: "paid" },
];

export function toPortalTimeline(steps: { key: string; status: string }[]): PortalTimeline {
  const statusByKey = new Map(steps.map((s) => [s.key, s.status]));
  const isDone = (k: string | null) => {
    if (k === null) return true;
    const st = statusByKey.get(k);
    return st === "completed" || st === "skipped";
  };

  let currentAssigned = false;
  const stages: PortalStage[] = STAGE_DEFS.map((d) => {
    let status: PortalStageStatus;
    if (isDone(d.doneKey)) status = "completed";
    else if (!currentAssigned) {
      currentAssigned = true;
      status = "current";
    } else status = "pending";
    return { key: d.key, status };
  });

  const completed = stages.filter((s) => s.status === "completed").length;
  const current = stages.find((s) => s.status === "current") ?? null;
  const currentIdx = current ? stages.findIndex((s) => s.key === current.key) : -1;
  const next = currentIdx >= 0 && currentIdx + 1 < stages.length ? stages[currentIdx + 1] : null;

  return {
    stages,
    currentKey: current ? current.key : null,
    nextKey: next ? next.key : null,
    percent: Math.round((completed / stages.length) * 100),
  };
}

/** Completed milestones, newest first — the customer activity feed (labels via i18n). */
export function portalActivity(timeline: PortalTimeline): PortalStageKey[] {
  return timeline.stages.filter((s) => s.status === "completed").map((s) => s.key).reverse();
}

/** French relative-time label for "last update". PURE (now injected). */
export function relativeLabel(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "à l'instant";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

export type PortalShipmentCards = { active: number; inTransit: number; delivered: number; awaitingPayment: number };

/** Portal "Mes expéditions" dashboard counts (Phase 2.4 D7). PURE. */
export function portalShipmentCards(
  files: { status: string; transportStatus: string | null }[],
  invoices: { status: string; balance: number }[],
): PortalShipmentCards {
  return {
    // DEC-B43 — the ONE active-dossier predicate (terminal CLOSED/CANCELLED excluded).
    active: files.filter((f) => !isFileStatus(f.status) || isActiveFileStatus(f.status)).length,
    inTransit: files.filter((f) => f.transportStatus === "PICKED_UP" || f.transportStatus === "IN_TRANSIT").length,
    delivered: files.filter(
      (f) => f.status === "DELIVERED" || f.transportStatus === "DELIVERED" || f.transportStatus === "POD_RECEIVED",
    ).length,
    awaitingPayment: invoices.filter((i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.balance > 0).length,
  };
}
