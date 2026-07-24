/**
 * Overdue-receivables adapter (Phase 10.0E-2). Consumes the SAME authoritative
 * source as the `creances_retard` KPI — getFinanceQueue + the reused
 * overdueRowsAtTenantDay predicate at the tenant-day boundary (DEC-B39). It
 * recreates no overdue arithmetic. A count-style alert only: NO amount, NO
 * currency, NO client name, NO trend. Zero overdue ⇒ [] (a true zero, `ok`);
 * a source failure ⇒ throw (unavailable).
 */
import { getFinanceQueue } from "@/lib/finance/service";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { overdueRowsAtTenantDay } from "@/lib/operations/kpi/compose";
import { resolveTimezone, tenantToday } from "@/lib/operations/kpi/windows";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlertAdapter } from "../types";

export const receivablesAdapter: OperationalAlertAdapter = {
  key: "receivables",
  available: (ctx) => hasPermission(ctx.permissions, "finance:read"),
  async load(ctx) {
    const admin = getAdminSupabaseClient();
    const [queue, timezone] = await Promise.all([
      getFinanceQueue(), // asserts finance:read (authoritative balances/statuses)
      admin
        .from("organization")
        .select("timezone")
        .eq("id", ctx.tenantId)
        .maybeSingle()
        .then((r) => resolveTimezone((r.data as { timezone?: string } | null)?.timezone), () => resolveTimezone(null)),
    ]);

    const overdue = overdueRowsAtTenantDay(
      queue.map((i) => ({ status: i.status, dueDate: i.dueDate, balance: i.balance, currency: i.currency })),
      tenantToday(timezone),
    );
    if (overdue.length === 0) return []; // truthful zero

    return [
      alertFrom({
        code: "finance.receivable.overdue", domain: "finance", level: "high",
        reason: `${overdue.length} facture(s) en retard de paiement`, href: "/collections",
      }),
    ];
  },
};
