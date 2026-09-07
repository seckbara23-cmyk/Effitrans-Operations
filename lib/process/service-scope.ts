/**
 * WHICH SERVICES did Effitrans actually sell on this dossier? PURE, client-safe.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-09-07 (OPS-SERVICE-SCOPE-01). A dossier does not automatically
 * require every Effitrans service. Three shapes must work today —
 * dédouanement only, transport only, and both — and a requirement belonging to
 * a service Effitrans is NOT providing is NOT_APPLICABLE. It is not missing,
 * not pending, not blocked and not failed.
 *
 * THE ORDER IS THE WHOLE DESIGN, and it is why this file sits ahead of both the
 * evidence evaluator and the leniency classifier:
 *
 *      APPLICABILITY  →  REQUIREMENT TIMING  →  LENIENCY  →  BLOCK / WARN / CONTINUE
 *
 * Asking « is this document present » before asking « did we sell this service »
 * is how a transport-only dossier ends up waiting for a customs declaration
 * nobody agreed to file.
 *
 * ── THREE VALUES, AND THE THIRD IS THE IMPORTANT ONE ────────────────────────
 * APPLICABLE / NOT_APPLICABLE / UNKNOWN. Only NOT_APPLICABLE changes anything.
 * UNKNOWN behaves EXACTLY as the platform behaved before this module existed —
 * that is the safety property that lets this ship against live dossiers whose
 * scope was never recorded, and it is the ratified rule for legacy rows:
 * « If it cannot be established safely: mark service scope UNKNOWN, do not
 * invent it. »
 *
 * ── WHERE A SCOPE COMES FROM ────────────────────────────────────────────────
 * STORED            the operator chose at creation. Migration 20261002000001
 *                   adds the column; it is NOT APPLIED, so no production
 *                   dossier can carry one yet and `scopeFromRow` degrades to:
 * DERIVED_FROM_TYPE from `operational_file.type`, and ONLY where a first-party
 *                   rule already ratified the answer (see TYPE_SCOPE).
 * UNKNOWN           nothing establishes it. Behaves as today.
 *
 * ── WHAT IS RATIFIED AND WHAT IS NOT ────────────────────────────────────────
 * The CUSTOMS side is ratified: Phase 9.0B's `STEP_APPLICABILITY` already
 * declares the nine customs-chain steps IMP/EXP-only, and the registry's own
 * pickup gate carries `customs_released.appliesToFileTypes = ["IMP","EXP"]`.
 * This module reproduces that answer and a test pins the equivalence, so the
 * two cannot drift.
 *
 * The TRANSPORT side is NOT ratified. No first-party Effitrans source says
 * which official steps fall away when Effitrans clears customs and the client
 * collects with their own carrier — `parallelGroup: "transport_readiness"` is a
 * statement about execution ORDER, not about what was contracted. The bindings
 * below are therefore marked `ratified: false`, and they are INERT in
 * production: only an explicit stored choice can produce
 * `transport: NOT_APPLICABLE`, and the column that would hold one is not
 * applied. Ruling questions RQ-SS-1..3 are in the programme report.
 */

/** The operational services Effitrans sells. Extensible; two are live today. */
export type ServiceKey = "customs" | "transport";

export const SERVICE_KEYS: readonly ServiceKey[] = ["customs", "transport"] as const;

/** French, for the creation form and the dossier header. */
export const SERVICE_LABEL_FR: Record<ServiceKey, string> = {
  customs: "Dédouanement",
  transport: "Transport",
};

export type ServiceApplicability = "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN";

export type ScopeSource = "STORED" | "DERIVED_FROM_TYPE" | "UNKNOWN";

export type ServiceScope = {
  customs: ServiceApplicability;
  transport: ServiceApplicability;
  source: ScopeSource;
};

/** Nothing is known. Every step applies, exactly as before this module. */
export const UNKNOWN_SCOPE: ServiceScope = {
  customs: "UNKNOWN",
  transport: "UNKNOWN",
  source: "UNKNOWN",
};

/**
 * What a dossier TYPE establishes, and nothing more.
 *
 * `customs` mirrors Phase 9.0B exactly (IMP/EXP carry a customs declaration;
 * TRP road transport and HND handling do not). `transport` stays UNKNOWN for
 * IMP/EXP because nothing rules on it — an import dossier may or may not
 * include the road leg, and guessing would be the defect this module exists to
 * prevent. TRP is the one type whose own definition IS a transport statement.
 */
const TYPE_SCOPE: Readonly<Record<string, Omit<ServiceScope, "source">>> = {
  IMP: { customs: "APPLICABLE", transport: "UNKNOWN" },
  EXP: { customs: "APPLICABLE", transport: "UNKNOWN" },
  TRP: { customs: "NOT_APPLICABLE", transport: "APPLICABLE" },
  HND: { customs: "NOT_APPLICABLE", transport: "UNKNOWN" },
};

/** The scope a dossier type establishes on its own. Unknown type ⇒ UNKNOWN. */
export function scopeFromFileType(fileType: string | null | undefined): ServiceScope {
  const t = typeof fileType === "string" ? fileType.trim().toUpperCase() : "";
  const known = TYPE_SCOPE[t];
  if (!known) return UNKNOWN_SCOPE;
  return { ...known, source: "DERIVED_FROM_TYPE" };
}

/**
 * The scope of a dossier ROW: the operator's explicit choice when the platform
 * has one, the type-derived answer otherwise.
 *
 * `services` is `null` on every production row today (migration 20261002000001
 * is written and NOT applied), and `undefined` when the projection did not ask
 * for the column at all — which is the schema-138 read path. Both fall through
 * to derivation rather than asserting « no services were sold ».
 */
export function scopeFromRow(row: {
  type: string | null | undefined;
  services?: readonly string[] | null;
}): ServiceScope {
  const chosen = normalizeServices(row.services);
  if (!chosen) return scopeFromFileType(row.type);
  return {
    customs: chosen.includes("customs") ? "APPLICABLE" : "NOT_APPLICABLE",
    transport: chosen.includes("transport") ? "APPLICABLE" : "NOT_APPLICABLE",
    source: "STORED",
  };
}

/**
 * A stored choice, or null when there is none to read.
 *
 * An EMPTY array is not a choice — it would mean « Effitrans sells nothing on
 * this dossier », which the creation form refuses and which no legacy row can
 * intend. Treated as absent so it degrades to derivation.
 */
export function normalizeServices(
  services: readonly string[] | null | undefined,
): ServiceKey[] | null {
  if (!Array.isArray(services)) return null;
  const known = services
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
    .filter((s): s is ServiceKey => (SERVICE_KEYS as readonly string[]).includes(s));
  return known.length > 0 ? [...new Set(known)] : null;
}

// ------------------------------------------------------- step ↔ service ------

export type StepServiceBinding = {
  service: ServiceKey;
  /** Has Effitrans ruled that this step belongs to that service? */
  ratified: boolean;
  /** First-party citation. Empty is only legal while `ratified` is false. */
  source: string;
};

const CUSTOMS_9 = "lib/process/applicability.ts STEP_APPLICABILITY (Phase 9.0B) — the nine customs-chain steps are IMP/EXP-only; registry PICKUP_READINESS.customs_released.appliesToFileTypes = [\"IMP\",\"EXP\"]";

/**
 * step key → the service it belongs to. Absent = ALWAYS_APPLICABLE.
 *
 * Nine ratified customs entries, seven UNRATIFIED transport proposals. The
 * transport half is a mapping waiting for a ruling, not a decision taken here;
 * see the header for why it is inert today.
 */
export const STEP_SERVICE: Readonly<Record<string, StepServiceBinding>> = {
  // ---- Dédouanement — RATIFIED (Phase 9.0B) ------------------------------
  transit_declarant_assignment: { service: "customs", ratified: true, source: CUSTOMS_9 },
  customs_preparation: { service: "customs", ratified: true, source: CUSTOMS_9 },
  transit_validation: { service: "customs", ratified: true, source: CUSTOMS_9 },
  coordinator_to_finance: { service: "customs", ratified: true, source: CUSTOMS_9 },
  gainde_registration: { service: "customs", ratified: true, source: CUSTOMS_9 },
  coordinator_to_declarant: { service: "customs", ratified: true, source: CUSTOMS_9 },
  gainde_document_submission: { service: "customs", ratified: true, source: CUSTOMS_9 },
  customs_followup: { service: "customs", ratified: true, source: CUSTOMS_9 },
  customs_field_clearance: { service: "customs", ratified: true, source: CUSTOMS_9 },

  // ---- Transport — PROPOSED, awaiting ruling (RQ-SS-1..3) ----------------
  // Inert while no ratified rule produces `transport: NOT_APPLICABLE`.
  transport_assignment: { service: "transport", ratified: false, source: "" },
  pickup: { service: "transport", ratified: false, source: "" },
  am_delivery_followup: { service: "transport", ratified: false, source: "" },
  transport_pod_handoff: { service: "transport", ratified: false, source: "" },
  bon_a_delivrer: { service: "transport", ratified: false, source: "" },
  pre_gate: { service: "transport", ratified: false, source: "" },
  transport_docs_transmission: { service: "transport", ratified: false, source: "" },
};

/** Bindings nobody has ruled on yet — surfaced by the governance report. */
export const UNRATIFIED_STEP_SERVICES: readonly string[] = Object.entries(STEP_SERVICE)
  .filter(([, b]) => !b.ratified)
  .map(([k]) => k);

export type StepApplicability =
  | { applicable: true; service: ServiceKey | null }
  | { applicable: false; service: ServiceKey; reasonFr: string };

/** « Non applicable — service non demandé », in the operator's words. */
export function notApplicableSentence(service: ServiceKey): string {
  return `Non applicable — ${SERVICE_LABEL_FR[service].toLowerCase()} non demandé sur ce dossier.`;
}

/**
 * Does this step apply, given what we know was sold?
 *
 * NOT_APPLICABLE requires a POSITIVE statement that the service is out of
 * scope. UNKNOWN never removes a step: a dossier whose scope was never recorded
 * keeps every step it has today.
 */
export function stepApplicability(stepKey: string, scope: ServiceScope): StepApplicability {
  const binding = STEP_SERVICE[stepKey];
  if (!binding) return { applicable: true, service: null };
  if (scope[binding.service] === "NOT_APPLICABLE") {
    return { applicable: false, service: binding.service, reasonFr: notApplicableSentence(binding.service) };
  }
  return { applicable: true, service: binding.service };
}

/** Convenience for callers that only need the boolean. */
export function stepAppliesToScope(stepKey: string, scope: ServiceScope): boolean {
  return stepApplicability(stepKey, scope).applicable;
}

/** Every step this scope puts out of play. Empty for UNKNOWN, by construction. */
export function inapplicableStepsForScope(scope: ServiceScope): string[] {
  return Object.keys(STEP_SERVICE).filter((k) => !stepAppliesToScope(k, scope));
}

/**
 * The scope, in one operator-facing phrase for the dossier header.
 *
 * An UNKNOWN scope says so rather than guessing « les deux » — the whole point
 * of the third value is that the platform does not claim what it was not told.
 */
export function scopeLabelFr(scope: ServiceScope): string {
  const sold = SERVICE_KEYS.filter((k) => scope[k] === "APPLICABLE").map((k) => SERVICE_LABEL_FR[k]);
  const unknown = SERVICE_KEYS.some((k) => scope[k] === "UNKNOWN");
  if (sold.length === 0) return "Services non précisés";
  return unknown ? `${sold.join(" + ")} (périmètre à préciser)` : sold.join(" + ");
}
