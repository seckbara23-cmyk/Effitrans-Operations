/**
 * Failed-communications adapter (Phase 10.0E-2). Uses the bounded head-count
 * helper (countCommunications) — it reads NO row content, so no recipient
 * address, last_error, or provider payload can enter the alert. A single
 * count-style alert, generic French reason, medium severity.
 *
 * A failed COMMUNICATION is a legitimate alert subject; it is never evidence
 * that the alert engine itself failed (that would be the source's `unavailable`).
 */
import { countCommunications } from "@/lib/comms/service";
import { hasPermission } from "@/lib/rbac/permissions";
import { alertFrom } from "./shared";
import type { OperationalAlertAdapter } from "../types";

export const communicationsAdapter: OperationalAlertAdapter = {
  key: "communications",
  available: (ctx) => hasPermission(ctx.permissions, "communication:read"),
  async load() {
    const failed = await countCommunications("FAILED"); // asserts communication:read; count only
    if (failed === 0) return [];
    return [
      alertFrom({
        code: "messaging.communication.failed", domain: "messaging", level: "medium",
        reason: `${failed} notification(s) non délivrée(s)`, href: "/communications",
      }),
    ];
  },
};
