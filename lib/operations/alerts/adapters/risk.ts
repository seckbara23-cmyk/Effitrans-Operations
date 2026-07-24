/**
 * Risk adapter (Phase 10.0E-2). Consumes the risk engine's OUTPUT via the
 * EXISTING cached Control Tower reader — never the risk engine directly (no
 * assessRisk / RISK_POINTS / riskLevel import). `attentionQueue` is already the
 * ranked high/critical set with terminal dossiers excluded (DEC-B43); the source
 * level is authoritative — this adapter re-scores nothing. Shares the same
 * request-cache()d pass as the `dossiers_intervention` KPI (DEC-B57).
 */
import { getControlTower } from "@/lib/control-tower/service";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlertAdapter } from "../types";

export const riskAdapter: OperationalAlertAdapter = {
  key: "risk",
  available: (ctx) => hasPermission(ctx.permissions, "analytics:read"),
  async load(ctx) {
    const ct = await getControlTower(ctx.permissions); // cached; asserts analytics:read
    return ct.attentionQueue.map((r) =>
      alertFrom({
        level: r.level === "critical" ? "critical" : "high", // source level authoritative (queue is high/critical only)
        domain: "operations",
        origin: "risk",
        code: r.level === "critical" ? "operations.dossier.risk_critical" : "operations.dossier.risk_high",
        reason: r.primaryReason, // existing authoritative French reason — not recomputed
        reference: r.fileNumber,
        clientName: r.clientName,
        href: `/files/${r.fileId}`,
        entityType: "dossier",
        entityId: r.fileId,
        // AttentionRiskItem carries no event timestamp — occurredAt omitted (never invented).
      }),
    );
  },
};
