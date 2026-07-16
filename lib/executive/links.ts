/**
 * Executive drill-down targets (Phase 7.7). PURE — no I/O, no server imports.
 * ---------------------------------------------------------------------------
 * Every executive figure links to the operational workspace that OWNS it. The dashboard creates
 * NO screen of its own: a drill-down always lands in the existing module. Kept pure (separate from
 * the server-only reader) so the deterministic card engine and its tests can use it directly.
 *
 * Each target is an EXISTING route — tests assert every one resolves to a real page.
 */
export const DRILL = {
  operations: "/departments/transport",
  shipping: "/shipping",
  air: "/air",
  road: "/departments/transport",
  customs: "/customs/intelligence",
  financial: "/departments/finance",
  customers: "/clients",
  // Document Intelligence has NO global workspace — it is per-document
  // (/files/[id]/documents/[docId]/intelligence), so the owning workspace for the executive
  // document KPIs is the Documentation department queue. Documented in docs/executive/.
  documents: "/departments/documentation",
  ai: "/settings/ai",
  reports: "/reports",
  management: "/departments/management",
} as const;

export type DrillKey = keyof typeof DRILL;

/** Command-Center mode → the workspace that owns that mode. */
export const MODE_HREF: Record<string, string> = {
  road: DRILL.road,
  ocean: DRILL.shipping,
  air: DRILL.air,
  customs: DRILL.customs,
};
