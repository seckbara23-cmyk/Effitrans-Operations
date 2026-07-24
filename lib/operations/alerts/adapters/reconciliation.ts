/**
 * Reconciliation adapter (Phase 10.0E-2). Consumes getReconciliation()'s
 * existing exception categories as count-style alerts. NO payment reference,
 * gateway error, or provider payload ever enters the alert text.
 */
import { getReconciliation } from "@/lib/finance/service";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlert, OperationalAlertAdapter } from "../types";

export const reconciliationAdapter: OperationalAlertAdapter = {
  key: "reconciliation",
  available: (ctx) => hasPermission(ctx.permissions, "finance:read"),
  async load() {
    const recon = await getReconciliation(); // asserts finance:read
    const failedIntents = recon.onlineIntents.filter((i) => i.status === "FAILED" || i.status === "EXPIRED").length;

    const out: OperationalAlert[] = [];
    if (recon.counts.missingReference > 0) {
      out.push(alertFrom({
        code: "finance.reconciliation.missing_reference", domain: "finance", level: "high",
        reason: `${recon.counts.missingReference} paiement(s) sans référence`, href: "/finance/reconciliation",
      }));
    }
    if (failedIntents > 0) {
      out.push(alertFrom({
        code: "finance.intent.failed", domain: "finance", level: "high",
        reason: `${failedIntents} intention(s) de paiement en échec`, href: "/finance/reconciliation",
      }));
    }
    if (recon.counts.pending > 0) {
      out.push(alertFrom({
        code: "finance.reconciliation.pending", domain: "finance", level: "medium",
        reason: `${recon.counts.pending} paiement(s) à vérifier`, href: "/finance/reconciliation",
      }));
    }
    return out;
  },
};
