/**
 * Command Center → alert mapping (Phase 10.0E-2). PURE (type-only imports, no
 * server deps) so the grounded-literal mapping is unit-testable in isolation.
 * Codes come ONLY from the repository-grounded categories the logistics reader
 * emits (lib/logistics/reader.ts:58–100); ocean/air messages are variable and
 * receive no inferred code (10.0E-0 §2).
 */
import type { AlertCode } from "../codes";
import type { AlertDomain, AlertEntityType } from "../types";
import type { UnifiedAlert } from "@/lib/logistics/compose";

export const MODE_DOMAIN: Record<UnifiedAlert["mode"], AlertDomain> = {
  road: "transport",
  ocean: "shipping",
  air: "air",
  customs: "customs",
};

/** Stable code from the source's grounded category (undefined ⇒ flows without a code). */
export function codeFor(a: UnifiedAlert): AlertCode | undefined {
  if (a.mode === "road") {
    if (a.reason === "Livraison routière en retard") return "transport.delivery.overdue";
    if (a.reason === "POD requis") return "transport.pod.owed";
  }
  if (a.mode === "customs") {
    if (a.reason.includes("bloquée") || a.reason.includes("rejetée")) return "customs.declaration.blocked";
    if (a.reason.includes("inspection")) return "customs.inspection.pending";
    if (a.reason.includes("paiement")) return "customs.payment.awaited";
  }
  return undefined; // ocean/air variable ShippingAlert message — no inferred code
}

/** Entity identity from the fixed link shapes only (deterministic, grounded). */
export function entityFromLink(link: string): { entityType?: AlertEntityType; entityId?: string } {
  const file = link.match(/^\/files\/([0-9a-fA-F-]{36})/);
  if (file) return { entityType: "dossier", entityId: file[1] };
  const ship = link.match(/^\/(?:shipping|air)\/shipments\/([^/?]+)/);
  if (ship) return { entityType: "shipment", entityId: ship[1] };
  return {};
}
