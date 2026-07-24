/**
 * Unified Alert Center — adapter helpers (Phase 10.0E-2). PURE.
 * ---------------------------------------------------------------------------
 * A single builder so every adapter projects into OperationalAlert identically
 * — no adapter re-implements the shape, and none injects raw data into display
 * strings. `reason` is caller-supplied French text; ids stay in `entityId`
 * (dedupe/drill-down only, never rendered).
 */
import type { AlertCode } from "../codes";
import type { AlertDomain, AlertEntityType, AlertLevel, OperationalAlert } from "../types";

export function alertFrom(input: {
  level: AlertLevel;
  domain: AlertDomain;
  reason: string;
  href: string;
  code?: AlertCode;
  origin?: string;
  reference?: string | null;
  clientName?: string | null;
  occurredAt?: string | null;
  entityType?: AlertEntityType;
  entityId?: string;
  /** raw source token (audit trail); defaults to the level for derived alerts. */
  sourceSeverity?: string;
}): OperationalAlert {
  return {
    level: input.level,
    origin: input.origin ?? input.domain,
    reference: input.reference ?? null,
    clientName: input.clientName ?? null,
    reason: input.reason,
    href: input.href,
    occurredAt: input.occurredAt ?? null,
    sourceSeverity: input.sourceSeverity ?? input.level,
    domain: input.domain,
    ...(input.code ? { code: input.code } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
  };
}
