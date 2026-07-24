/**
 * Messaging adapter (Phase 10.0E-2). TENANT-operational conversation signals
 * only — urgent open + waiting-on-us — from getMessagingDashboardSummary.
 * It NEVER imports unreadStaffMessagingCount (that is a PERSONAL, RLS-per-viewer
 * signal and must stay outside the tenant alert center, DEC-B56). Count-style.
 */
import { getMessagingDashboardSummary } from "@/lib/messaging/dashboard";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlert, OperationalAlertAdapter } from "../types";

export const messagingAdapter: OperationalAlertAdapter = {
  key: "messaging",
  available: (ctx) => hasPermission(ctx.permissions, "messaging:manage"),
  async load(ctx) {
    const summary = await getMessagingDashboardSummary(ctx.userId, ctx.tenantId); // null unless messaging:manage
    if (summary === null) throw new Error("messaging summary unavailable");

    const out: OperationalAlert[] = [];
    if (summary.urgentOpen > 0) {
      out.push(alertFrom({
        code: "messaging.conversation.urgent", domain: "messaging", level: "high",
        reason: `${summary.urgentOpen} conversation(s) client urgente(s)`, href: "/messages",
      }));
    }
    if (summary.waitingEffitrans > 0) {
      out.push(alertFrom({
        code: "messaging.conversation.awaiting_reply", domain: "messaging", level: "medium",
        reason: `${summary.waitingEffitrans} conversation(s) en attente de réponse`, href: "/messages",
      }));
    }
    return out;
  },
};
