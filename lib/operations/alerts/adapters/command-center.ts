/**
 * Command Center adapter (Phase 10.0E-2). Projects the EXISTING unified attention
 * queue (`getCommandCenter().attention`) verbatim — preserving reason / reference
 * / clientName / destination / timestamp / source severity — and stamps a stable
 * code by the source's REPOSITORY-GROUNDED category. It reinterprets no severity
 * and invents no delay definition.
 *
 * Code mapping (grounded in lib/logistics/reader.ts:58–100):
 *  - road literals « Livraison routière en retard » / « POD requis » → transport.*
 *  - customs aggregates (severity + the fixed « bloquée/rejetée / inspection /
 *    paiement » category words) → customs.*
 *  - ocean/air alerts carry a VARIABLE ShippingAlert message (their source code
 *    was already dropped by UnifiedAlert, 10.0E-0 §2) → NO code inferred from
 *    arbitrary text; the alert still flows (deduped by its legacy key).
 * entityId is parsed only from the fixed link shapes (dossier / shipment) so
 * per-dossier coded alerts dedupe distinctly; aggregate customs alerts (no
 * entity) dedupe by code alone — correct one-per-category.
 */
import { getCommandCenter } from "@/lib/logistics/reader";
import { normalizeSeverity } from "@/lib/executive/compose";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import { MODE_DOMAIN, codeFor, entityFromLink } from "./command-center-mapping";
import type { OperationalAlertAdapter } from "../types";

export const commandCenterAdapter: OperationalAlertAdapter = {
  key: "command-center",
  available: (ctx) => hasPermission(ctx.permissions, "transport:read"),
  async load() {
    const cc = await getCommandCenter(); // cached; asserts transport:read
    return cc.attention.map((a) => {
      const entity = entityFromLink(a.link);
      return alertFrom({
        level: normalizeSeverity(a.severity), // the ONE shared normalizer — no reinterpretation
        domain: MODE_DOMAIN[a.mode],
        origin: a.mode,
        code: codeFor(a),
        reason: a.reason,
        reference: a.reference,
        clientName: a.clientName,
        href: a.link,
        occurredAt: a.occurredAt ?? null,
        sourceSeverity: a.severity,
        ...entity,
      });
    });
  },
};
