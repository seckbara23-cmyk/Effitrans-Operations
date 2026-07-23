/**
 * Official process engine feature flags (Phase 5.0B) — PURE, unit-testable.
 * ---------------------------------------------------------------------------
 * DARK BY DEFAULT. With the master flag off the engine is completely inert:
 *   * no process instance is ever auto-initialized,
 *   * no existing page, action or query changes behaviour,
 *   * the legacy dossier lifecycle (operational_file.status) remains the sole
 *     driver of every shipped feature,
 *   * the diagnostic route 404s.
 * The engine NEVER writes operational_file in 5.0B, so "flag off" and "flag on
 * but no instance" are both indistinguishable from today's production.
 *
 * Same idiom as lib/tracking/flags.ts: no process.env access here, so the
 * resolution rules are testable with plain inputs; the server-only reader lives
 * in ./config.
 */
export type ProcessFlagEnv = {
  EFFITRANS_PROCESS_ENGINE_ENABLED?: string;
  /**
   * Phase 5.0C — the staff workspaces (My Work, the 15 department queues, the
   * Coordinator process tower). Separate from the engine flag so the engine can
   * be exercised by API/tests before any queue route appears in navigation.
   * Requires the master flag: queues over a dark engine would always be empty.
   */
  EFFITRANS_PROCESS_WORKSPACES_ENABLED?: string;
  /** Allow initializing an instance for a LEGACY dossier (compatibility mapping). */
  EFFITRANS_PROCESS_COMPATIBILITY_ENABLED?: string;
  /**
   * Governance escape hatch for the maker-checker rule. Even when ON, the actor
   * must ALSO hold `process:override` and supply a justification — the flag alone
   * permits nothing. Off => self-validation is impossible for everyone.
   */
  EFFITRANS_PROCESS_OVERRIDE_ENABLED?: string;
  /**
   * Phase 9.0B — the dossier workflow STRUCTURAL extensions (canonical owner,
   * recorded decisions, formal blockers, Transit team dispatch, explicit skips).
   * Requires the master flag. Off => every structures action refuses; the new
   * tables exist but nothing writes them.
   */
  EFFITRANS_PROCESS_STRUCTURES_ENABLED?: string;
  /**
   * Phase 5.0D — the physical invoice deposit chain (Administration -> Courier ->
   * proof -> Collections handoff). Separate from collections so a tenant that
   * only emails invoices never sees a courier workflow.
   */
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED?: string;
  /** Phase 5.0D — the collections workspace (aging, follow-ups, promises). */
  EFFITRANS_COLLECTIONS_ENABLED?: string;
};

export type ProcessFlags = {
  /** Master switch. Off => the entire engine is dark. */
  enabled: boolean;
  /** Compatibility initialization for pre-engine dossiers (requires master). */
  compatibility: boolean;
  /** Maker-checker override seam (requires master). Disabled by default. */
  overrideAllowed: boolean;
  /** Phase 5.0C staff workspaces + queue navigation (requires master). */
  workspaces: boolean;
  /** Phase 5.0D physical invoice deposit chain (requires master). */
  physicalDeposit: boolean;
  /** Phase 5.0D collections workspace (requires master). */
  collections: boolean;
  /** Phase 9.0B workflow structural extensions (requires master). */
  structures: boolean;
};

const on = (v: string | undefined): boolean => v === "true";

export function resolveProcessFlags(env: ProcessFlagEnv): ProcessFlags {
  const enabled = on(env.EFFITRANS_PROCESS_ENGINE_ENABLED);
  return {
    enabled,
    // A sub-capability is only live when the master flag is also on.
    compatibility: enabled && on(env.EFFITRANS_PROCESS_COMPATIBILITY_ENABLED),
    overrideAllowed: enabled && on(env.EFFITRANS_PROCESS_OVERRIDE_ENABLED),
    workspaces: enabled && on(env.EFFITRANS_PROCESS_WORKSPACES_ENABLED),
    physicalDeposit: enabled && on(env.EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED),
    collections: enabled && on(env.EFFITRANS_COLLECTIONS_ENABLED),
    structures: enabled && on(env.EFFITRANS_PROCESS_STRUCTURES_ENABLED),
  };
}
