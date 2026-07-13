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
  /** Allow initializing an instance for a LEGACY dossier (compatibility mapping). */
  EFFITRANS_PROCESS_COMPATIBILITY_ENABLED?: string;
  /**
   * Governance escape hatch for the maker-checker rule. Even when ON, the actor
   * must ALSO hold `process:override` and supply a justification — the flag alone
   * permits nothing. Off => self-validation is impossible for everyone.
   */
  EFFITRANS_PROCESS_OVERRIDE_ENABLED?: string;
};

export type ProcessFlags = {
  /** Master switch. Off => the entire engine is dark. */
  enabled: boolean;
  /** Compatibility initialization for pre-engine dossiers (requires master). */
  compatibility: boolean;
  /** Maker-checker override seam (requires master). Disabled by default. */
  overrideAllowed: boolean;
};

const on = (v: string | undefined): boolean => v === "true";

export function resolveProcessFlags(env: ProcessFlagEnv): ProcessFlags {
  const enabled = on(env.EFFITRANS_PROCESS_ENGINE_ENABLED);
  return {
    enabled,
    // A sub-capability is only live when the master flag is also on.
    compatibility: enabled && on(env.EFFITRANS_PROCESS_COMPATIBILITY_ENABLED),
    overrideAllowed: enabled && on(env.EFFITRANS_PROCESS_OVERRIDE_ENABLED),
  };
}
