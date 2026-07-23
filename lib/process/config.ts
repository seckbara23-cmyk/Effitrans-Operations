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
    EFFITRANS_PROCESS_WORKSPACES_ENABLED: process.env.EFFITRANS_PROCESS_WORKSPACES_ENABLED,
    EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: process.env.EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED,
    EFFITRANS_COLLECTIONS_ENABLED: process.env.EFFITRANS_COLLECTIONS_ENABLED,
    EFFITRANS_PROCESS_STRUCTURES_ENABLED: process.env.EFFITRANS_PROCESS_STRUCTURES_ENABLED,
    EFFITRANS_OPERATIONS_INTAKE_ENABLED: process.env.EFFITRANS_OPERATIONS_INTAKE_ENABLED,
    EFFITRANS_TRANSIT_EXECUTION_ENABLED: process.env.EFFITRANS_TRANSIT_EXECUTION_ENABLED,
    EFFITRANS_FINANCE_EXECUTION_ENABLED: process.env.EFFITRANS_FINANCE_EXECUTION_ENABLED,
  });
}

/** True when the engine may run at all. Every engine mutation checks this first. */
export function processEngineEnabled(): boolean {
  return getProcessFlags().enabled;
}

/** True when the Phase 5.0C staff workspaces + queue navigation are visible. */
export function processWorkspacesEnabled(): boolean {
  return getProcessFlags().workspaces;
}
