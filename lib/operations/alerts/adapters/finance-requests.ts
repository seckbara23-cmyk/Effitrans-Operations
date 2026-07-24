/**
 * Finance-request adapter (Phase 10.0E-2). Consumes the 10.0B bounded reader.
 * Presence-only count-style alerts (no age threshold, no amounts, no raw ids).
 * The source returns null when finance execution is dark (migration absent /
 * flag off) — that is UNAVAILABLE (throw), never a silent zero.
 */
import { getFinanceRequestQueue } from "@/lib/operations/finance-requests";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlert, OperationalAlertAdapter } from "../types";

export const financeRequestsAdapter: OperationalAlertAdapter = {
  key: "finance-requests",
  available: (ctx) => hasPermission(ctx.permissions, "finance:read"),
  async load() {
    const q = await getFinanceRequestQueue(); // asserts finance:read + financeExecution flags
    if (q === null) throw new Error("finance execution unavailable"); // dark ⇒ unavailable, not zero

    const out: OperationalAlert[] = [];
    if (q.pendingReview > 0) {
      out.push(alertFrom({
        code: "finance.request.pending_review", domain: "finance", level: "high",
        reason: `${q.pendingReview} demande(s) financière(s) à examiner`, href: "/finance",
        occurredAt: q.oldestRequestedAt ?? null, // authoritative source timestamp (oldest pending)
      }));
    }
    if (q.approvedNotDisbursed > 0) {
      out.push(alertFrom({
        code: "finance.request.approved_not_disbursed", domain: "finance", level: "medium",
        reason: `${q.approvedNotDisbursed} demande(s) approuvée(s) non décaissée(s)`, href: "/finance",
      }));
    }
    const evidence = q.evidenceMissing + q.evidenceToVerify;
    if (evidence > 0) {
      out.push(alertFrom({
        code: "finance.disbursement.evidence_owed", domain: "finance", level: "high",
        reason: `${evidence} justificatif(s) de décaissement à fournir ou vérifier`, href: "/finance",
      }));
    }
    return out;
  },
};
