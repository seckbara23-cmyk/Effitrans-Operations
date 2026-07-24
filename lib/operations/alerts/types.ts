/**
 * Unified Alert Center — contract (Phase 10.0E-1). PURE TYPES.
 * ---------------------------------------------------------------------------
 * DEC-B47/B34: the alert layer OWNS composition, contracts, normalization,
 * codes and dedupe — it OWNS no business rule. `OperationalAlert` is an ADDITIVE
 * structural extension of the proven `ExecutiveAlert` (an OperationalAlert IS an
 * ExecutiveAlert plus optional metadata), so the executive dashboard can consume
 * `OperationalAlert[]` unchanged and the shared normalize/merge engine is reused
 * verbatim — never re-implemented.
 *
 * Availability is a property of the SET, never of an item (DEC-B58): an item has
 * no "resolved"/"active" state — computed alerts exist while their source
 * condition holds (DEC-B48). A source that failed / is dark / is unpermissioned
 * is reported in `sources[]`, never as "0 alertes".
 */
import type { ExecutiveAlert } from "@/lib/executive/types";
import type { AlertCode } from "./codes";

/** Normalized alert domains (DEC-B50 companion). No aliases, no UI labels. */
export const ALERT_DOMAINS = [
  "operations", "customs", "transport", "shipping", "air",
  "finance", "documents", "messaging", "system",
] as const;
export type AlertDomain = (typeof ALERT_DOMAINS)[number];

/** Internal entity kinds — for dedupe + drill-down keys ONLY (never rendered). */
export const ALERT_ENTITY_TYPES = [
  "dossier", "shipment", "declaration", "transport", "finance_request",
  "payment", "invoice", "conversation", "communication", "document",
] as const;
export type AlertEntityType = (typeof ALERT_ENTITY_TYPES)[number];

/**
 * One normalized alert. Inherits `level` (critical/high/medium/low, already
 * normalized by the shared engine), `origin`, `reference` (display ref, e.g. a
 * file number), `clientName`, `reason` (French display text), `href` (drill-down
 * — empty string means "no credible destination", DEC-B54), `occurredAt`,
 * `sourceSeverity` (audit trail). Adds:
 */
export type OperationalAlert = ExecutiveAlert & {
  /** DEC-B34: optional stable machine code. */
  code?: AlertCode;
  /** normalized domain (the raw module token stays in `origin`). */
  domain: AlertDomain;
  /** internal entity kind — dedupe / drill-down metadata, NEVER rendered (§24). */
  entityType?: AlertEntityType;
  /** internal entity id — dedupe / drill-down metadata, NEVER rendered (§24). */
  entityId?: string;
};

export type AlertLevel = ExecutiveAlert["level"];

/** Per-source availability — DEC-B58. `omitted` = permission absent; `unavailable` = dark/failed. */
export type AlertSourceStatus = "ok" | "unavailable" | "omitted";
export type AlertSource = { key: string; status: AlertSourceStatus };

/** The composed, permission-shaped set — the reader's return contract. */
export type OperationalAlertSet = {
  generatedAt: string;
  alerts: OperationalAlert[];
  counts: Record<AlertLevel, number>;
  sources: AlertSource[];
};

// ---------------------------------------------------------------- adapter interface ----

/** Bounded context an adapter receives (resolved once by the reader). */
export type AlertAdapterContext = {
  userId: string;
  tenantId: string;
  permissions: string[];
};

/**
 * A source adapter (implemented from Phase 10.0E-2). PURE CONTRACT ONLY here.
 * `available` gates on the SOURCE permission — false ⇒ the source is OMITTED
 * (absent ≠ zero). `load` returns already-normalized OperationalAlerts, or
 * rejects to mark the source `unavailable` (dark flag / query failure). An empty
 * array means "authorized, nothing to report" (a true zero — status `ok`).
 * Adapters CONSUME existing bounded readers; they own no business rule.
 */
export type OperationalAlertAdapter = {
  /** stable key surfaced in `sources[]`. */
  key: string;
  available?(ctx: AlertAdapterContext): boolean;
  load(ctx: AlertAdapterContext): Promise<OperationalAlert[]>;
};
