/**
 * FIN-AGING-1 — the pure Aging Balance engine. Barrel.
 * ---------------------------------------------------------------------------
 * DARK: nothing here is reachable from a route, no data is written, no
 * permission is granted, no migration exists. The engine computes; a later
 * phase gives it inputs and renderers.
 *
 * The layering the module is required to preserve:
 *
 *     AR financial inputs          (types.ts — assembled by a future data layer)
 *              ↓
 *     Outstanding-balance calc     (balance.ts — as of the reporting date)
 *              ↓
 *     Aging classification         (buckets.ts — scheme registry)
 *              ↓
 *     Aggregations                 (report.ts — buckets, clients, KPIs, shares)
 *              ↓
 *     Five-tab report view model   (report.ts — the single source for renderers)
 *
 * Nothing in this directory may import an Excel library, a PDF library, a UI
 * component, a Supabase client, a Next.js server action or a storage client.
 * That boundary is enforced by tests/fin-aging-engine.test.ts.
 */
export * from "./money";
export * from "./dates";
export * from "./buckets";
export * from "./share";
export * from "./types";
export { balanceAsOf, isEffectiveAsOf, isCancelledAsOf, isIssuedAsOf, type BalanceAsOf } from "./balance";
export { buildAgingReport, AgingEngineError } from "./report";
