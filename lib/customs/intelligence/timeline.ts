/**
 * Customs Intelligence — declaration timeline (Phase 7.1A). PURE.
 * ---------------------------------------------------------------------------
 * Every declaration produces IMMUTABLE timeline events. This REUSES the existing audit
 * model (no new table): a transition is persisted as a customs audit event, and the
 * timeline is a projection of those rows. This module is the pure model + the mapping in
 * both directions — persistence happens through the existing writeAudit in 7.1B.
 */
import { AuditActions } from "@/lib/audit/events";
import { declarationLabel, type DeclarationStatus } from "./state-machine";

export type TimelineEvent = {
  occurredAt: string;
  status: DeclarationStatus;
  provider: string;
  actor: string | null;
  description: string;
  metadata: Record<string, unknown>;
};

/** The audit payload for a transition — written via the EXISTING writeAudit (reuse). Carries
 *  only safe metadata (status/provider/reason), never document contents or secrets. */
export function transitionAuditPayload(input: {
  declarationId: string;
  from: DeclarationStatus;
  to: DeclarationStatus;
  provider: string;
  reason?: string | null;
}): { action: string; entity: string; entityId: string; before: Record<string, unknown>; after: Record<string, unknown> } {
  return {
    action: AuditActions.CUSTOMS_STATUS_CHANGED,
    entity: "customs_declaration",
    entityId: input.declarationId,
    before: { status: input.from },
    after: { status: input.to, provider: input.provider, reason: input.reason ?? null },
  };
}

/** A stored audit row (the safe projection input). */
export type AuditTimelineRow = {
  occurredAt: string;
  actorLabel: string | null;
  after: { status?: string; provider?: string; reason?: string | null } | null;
};

/** Project stored customs audit rows into an immutable, chronologically-ordered timeline. */
export function projectTimeline(rows: AuditTimelineRow[]): TimelineEvent[] {
  return rows
    .filter((r) => r.after && typeof r.after.status === "string")
    .map((r) => {
      const status = r.after!.status as DeclarationStatus;
      const provider = r.after!.provider ?? "manual";
      return {
        occurredAt: r.occurredAt,
        status,
        provider,
        actor: r.actorLabel ?? null,
        description: `Statut : ${declarationLabel(status)}`,
        metadata: { reason: r.after!.reason ?? null },
      };
    })
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
}

/** The first/last event for quick summaries (null on an empty timeline). */
export function timelineBounds(events: TimelineEvent[]): { first: TimelineEvent | null; last: TimelineEvent | null } {
  if (events.length === 0) return { first: null, last: null };
  return { first: events[0], last: events[events.length - 1] };
}
