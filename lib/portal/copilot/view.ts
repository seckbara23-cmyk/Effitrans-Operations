/**
 * Customer AI Assistant — customer-safe view derivations (Phase 7.6C). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Follows the existing portal split (pure `tracking-derive.ts` vs server-only `tracking.ts`):
 * the mappings that decide WHAT a customer may see live here, unit-tested, with no server
 * imports; `context.ts` only composes the RLS-enforced readers and calls these.
 *
 * Each function narrows an internal shape to a customer-safe one — that narrowing is the security
 * boundary, so it is kept pure and directly testable.
 */
import type { PortalCarriage } from "../carriage";
import type { PortalTimeline } from "../progress-map";
import type { PortalCopilotCustoms, PortalCopilotMap } from "./types";

/**
 * Customer-safe customs view derived ONLY from the CUSTOMER timeline (progress-map stages), never
 * from customs_record.status. The customer learns that clearance is pending / underway / done —
 * never a rejection, an inspection, or an internal blocking reason.
 */
export function portalCustomsView(input: { timeline: PortalTimeline }): PortalCopilotCustoms {
  const byKey = new Map(input.timeline.stages.map((s) => [s.key, s.status] as const));
  if (byKey.get("customs_done") === "completed") return { state: "cleared", label: "Dédouanement terminé" };
  const started =
    byKey.get("customs_in_progress") === "completed" ||
    byKey.get("customs_in_progress") === "current" ||
    byKey.get("customs_done") === "current";
  if (started) return { state: "in_progress", label: "Dédouanement en cours" };
  return { state: "not_started", label: "Dédouanement pas encore commencé" };
}

/**
 * Customer-safe map summary: presence + the last located point only. Deliberately drops the
 * marker's provider `source` and tracking `confidence` (internal), keeping `freshness` — which the
 * portal map already shows — so the assistant can date a position instead of implying it is live.
 */
export function portalMapSummary(carriage: PortalCarriage): PortalCopilotMap {
  const cur = carriage.map.currentPosition;
  return {
    hasGeo: carriage.hasGeo,
    positionLabel: cur?.label ?? null,
    positionAt: cur?.occurredAt ?? null,
    positionFreshness: cur?.freshness ?? null,
    milestoneCount: carriage.map.milestones.length,
  };
}
