/**
 * Server-only reader for the process-engine flags (Phase 5.0B).
 * ---------------------------------------------------------------------------
 * Mirrors lib/tracking/config.ts: the pure resolution rules live in ./flags,
 * this file is the only place that touches process.env.
 */
import "server-only";
import { resolveProcessFlags, type ProcessFlags } from "./flags";

export function getProcessFlags(): ProcessFlags {
  return resolveProcessFlags({
    EFFITRANS_PROCESS_ENGINE_ENABLED: process.env.EFFITRANS_PROCESS_ENGINE_ENABLED,
    EFFITRANS_PROCESS_COMPATIBILITY_ENABLED: process.env.EFFITRANS_PROCESS_COMPATIBILITY_ENABLED,
    EFFITRANS_PROCESS_OVERRIDE_ENABLED: process.env.EFFITRANS_PROCESS_OVERRIDE_ENABLED,
  });
}

/** True when the engine may run at all. Every engine mutation checks this first. */
export function processEngineEnabled(): boolean {
  return getProcessFlags().enabled;
}
