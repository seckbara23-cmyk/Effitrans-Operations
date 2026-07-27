/**
 * Event metadata contract (Phase WES-9C) — PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Metadata answers "what changed", never "here is the whole row". An event
 * ledger is immutable and long-lived: anything copied into it can never be
 * corrected, redacted or deleted later. So the rule is the strict one —
 *
 *   IDENTIFIERS AND STATUS CODES ONLY. NEVER FREE TEXT, NEVER MONEY,
 *   NEVER PERSONAL DATA, NEVER FILE CONTENT, NEVER A ROW SNAPSHOT.
 *
 * Enforced three ways, deliberately overlapping:
 *   1. a per-type ALLOW-LIST (lib/workflow/events/types.ts) — an unknown key is
 *      rejected, not dropped, so a mistake surfaces at the call site;
 *   2. a DENY-LIST of key names that must never appear regardless of type,
 *      catching a future type declaring a dangerous key by accident;
 *   3. VALUE constraints — scalars only, bounded length, no nesting.
 *
 * Amounts are the case worth spelling out. `payment.amount` is not secret, but
 * an immutable copy of it in a second table becomes a financial record that can
 * drift from the ledger it was copied from and can never be corrected. The
 * event says a payment was recorded and points at it; `payment` stays
 * authoritative. Same reasoning for names, addresses, phone numbers and
 * rejection reasons — the event points, the domain row holds.
 */

import { EVENT_TYPES, getEventType } from "./types";

/** Key names that may never appear in metadata, whatever the event type. */
export const PROHIBITED_METADATA_KEYS = [
  "amount",
  "total",
  "price",
  "cost",
  "currency",
  "balance",
  "name",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "notes",
  "note",
  "comment",
  "comments",
  // Stays banned. WES-4 carries reason_code / has_reason / reason_reference_id;
  // the bare key would be the free text itself.
  "reason",
  "description",
  "message",
  "content",
  "body",
  "text",
  "payload",
  "snapshot",
  "row",
  "data",
  "password",
  "token",
  "secret",
  "url",
  "path",
  "storage_path",
  "file_name",
  "filename",
] as const;

const PROHIBITED = new Set<string>(PROHIBITED_METADATA_KEYS);

/** Bounds. Identifiers and status codes are short; anything long is prose. */
export const MAX_METADATA_KEYS = 12;
export const MAX_METADATA_VALUE_LENGTH = 120;
export const MAX_METADATA_BYTES = 2048;

export type MetadataError =
  | { code: "unknown_event_type"; key: string }
  | { code: "reserved_event_type"; key: string }
  | { code: "not_an_object"; key: string }
  | { code: "too_many_keys"; key: string }
  | { code: "too_large"; key: string }
  | { code: "key_not_allowed"; key: string }
  | { code: "prohibited_key"; key: string }
  | { code: "value_not_scalar"; key: string }
  | { code: "value_too_long"; key: string };

export type MetadataResult =
  | { ok: true; metadata: Record<string, string | number | boolean> }
  | { ok: false; errors: MetadataError[] };

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v))
  );
}

/**
 * Validate metadata for an event type. Fail-closed: on ANY error nothing is
 * returned, so a caller cannot accidentally persist a partially-scrubbed
 * object. Callers decide whether a rejection blocks the domain action —
 * WES-9D says it must NOT, so the writer downgrades this to a dropped event
 * plus a loud audit entry rather than failing a legitimate business write.
 */
export function validateEventMetadata(
  eventType: string,
  metadata: unknown,
): MetadataResult {
  const def = getEventType(eventType);
  if (!def) return { ok: false, errors: [{ code: "unknown_event_type", key: eventType }] };
  if (def.emission === "reserved") {
    return { ok: false, errors: [{ code: "reserved_event_type", key: eventType }] };
  }

  if (metadata === null || metadata === undefined) return { ok: true, metadata: {} };
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, errors: [{ code: "not_an_object", key: eventType }] };
  }

  const entries = Object.entries(metadata as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  const errors: MetadataError[] = [];

  if (entries.length > MAX_METADATA_KEYS) {
    errors.push({ code: "too_many_keys", key: eventType });
  }

  const allowed = new Set(def.metadataKeys);
  const clean: Record<string, string | number | boolean> = {};

  for (const [key, value] of entries) {
    if (PROHIBITED.has(key)) {
      errors.push({ code: "prohibited_key", key });
      continue;
    }
    if (!allowed.has(key)) {
      errors.push({ code: "key_not_allowed", key });
      continue;
    }
    if (!isScalar(value)) {
      errors.push({ code: "value_not_scalar", key });
      continue;
    }
    if (typeof value === "string" && value.length > MAX_METADATA_VALUE_LENGTH) {
      errors.push({ code: "value_too_long", key });
      continue;
    }
    clean[key] = value;
  }

  if (JSON.stringify(clean).length > MAX_METADATA_BYTES) {
    errors.push({ code: "too_large", key: eventType });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, metadata: clean };
}

/**
 * Assert at BUILD/TEST time that no declared type allows a prohibited key.
 * The per-type allow-lists are hand-written; this is what stops a future
 * "just add `reason` to the rejection event" from quietly landing.
 */
export function registryMetadataViolations(): { type: string; key: string }[] {
  const out: { type: string; key: string }[] = [];
  for (const def of EVENT_TYPES) {
    for (const key of def.metadataKeys) {
      if (PROHIBITED.has(key)) out.push({ type: def.type, key });
    }
  }
  return out;
}
