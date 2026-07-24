/**
 * Unified Alert Center — stable alert codes (Phase 10.0E-1). PURE.
 * ---------------------------------------------------------------------------
 * DEC-B34 / DEC-B51: an OPTIONAL, machine-readable, stable code per alert, in
 * the form `domain.entity.condition`. Codes are stable across French label
 * changes, contain no tenant ids / dossier numbers / names / translated text,
 * and a semantic change means a NEW code (never reuse). Ownership is per-domain
 * (the typed unions below); adapters (Phase 10.0E-2) map their source to one of
 * THESE codes only — no code may be fabricated ahead of an authoritative source.
 *
 * This file holds ONLY the approved initial vocabulary from the 10.0E-0 audit
 * (§6). Documents codes ship in 10.0E-2-later once a tenant-wide reader exists.
 */

/** `domain.entity.condition` — lowercase, dot-separated, snake_case segments. */
export const ALERT_CODE_PATTERN = /^[a-z]+(\.[a-z_]+){2}$/;

export const OPERATIONS_ALERT_CODES = [
  // Level-based v1 (the risk engine exposes French reasons, not machine kinds —
  // per-reason codes are a deferred additive engine change, see 10.0E-0 §6).
  "operations.dossier.risk_critical",
  "operations.dossier.risk_high",
] as const;

export const CUSTOMS_ALERT_CODES = [
  "customs.declaration.blocked",
  "customs.inspection.pending",
  "customs.payment.awaited",
] as const;

export const TRANSPORT_ALERT_CODES = [
  "transport.delivery.overdue",
  "transport.pod.owed",
] as const;

export const SHIPPING_ALERT_CODES = [
  "shipping.eta.delayed",
  "shipping.tracking.stale",
] as const;

export const AIR_ALERT_CODES = [
  "air.eta.delayed",
  "air.tracking.stale",
] as const;

export const FINANCE_ALERT_CODES = [
  "finance.request.pending_review",
  "finance.request.approved_not_disbursed",
  "finance.disbursement.evidence_owed",
  "finance.reconciliation.pending",
  "finance.reconciliation.missing_reference",
  "finance.intent.failed",
  "finance.receivable.overdue",
] as const;

export const MESSAGING_ALERT_CODES = [
  "messaging.conversation.awaiting_reply",
  "messaging.conversation.urgent",
  "messaging.communication.failed",
] as const;

export const DOCUMENTS_ALERT_CODES = [
  // 10.0E-2-later — no tenant-wide expiry reader exists yet.
  "documents.document.expired",
  "documents.document.expiring",
] as const;

/** The full approved vocabulary. */
export const ALERT_CODES = [
  ...OPERATIONS_ALERT_CODES,
  ...CUSTOMS_ALERT_CODES,
  ...TRANSPORT_ALERT_CODES,
  ...SHIPPING_ALERT_CODES,
  ...AIR_ALERT_CODES,
  ...FINANCE_ALERT_CODES,
  ...MESSAGING_ALERT_CODES,
  ...DOCUMENTS_ALERT_CODES,
] as const;

export type AlertCode = (typeof ALERT_CODES)[number];

export function isAlertCode(value: string): value is AlertCode {
  return (ALERT_CODES as readonly string[]).includes(value);
}
