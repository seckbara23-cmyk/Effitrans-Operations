import "server-only";

/**
 * HR-5A — the executive dashboard's HR reader. COMPOSITION ONLY.
 * ---------------------------------------------------------------------------
 * Every figure is read from a service HR-1..HR-5 already owns. Nothing is
 * computed here, no new engine exists, and no HR business rule lives in the
 * executive module.
 *
 * SELF-GATED, and this is the point. The executive dashboard's own permission
 * is `executive:dashboard:read`. HR data is gated on `hr:read`. A viewer who
 * holds the first and not the second must see NOTHING of HR — so this reader
 * returns null for them, and the dashboard reports HR as *unavailable* rather
 * than as zero. The same shape `canFinance` already uses for the financial row:
 * withheld, never zeroed.
 *
 * Deliberately EXCLUDED: turnover, absence rate, average onboarding duration.
 * They need ratified formulas and a period model that do not exist; inventing
 * either in an activation phase would be inventing a business rule.
 */
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { assertPermission } from "@/lib/auth/require-permission";
import { employeeStats } from "@/lib/hr/read";
import { hrOperationsCounts } from "@/lib/hr/onboarding";
import { leaveCounts } from "@/lib/hr/leave";
import { expiringContracts, expiringDocuments, EXPIRY_WINDOW_DAYS } from "@/lib/hr/workspace";

export type HrOverview = {
  headcount: number;
  onLeaveToday: number;
  activeOnboarding: number;
  contractsExpiring: number;
  documentsExpiring: number;
  equipmentIssued: number;
  expiryWindowDays: number;
};

/** Null when the viewer may not read HR — withheld, not zeroed. */
export async function readHrOverview(): Promise<HrOverview | null> {
  const user = await assertPermission("executive:dashboard:read");
  const perms = await getEffectivePermissions(user.id);
  if (!hasPermission(perms, "hr:read")) return null;

  const [stats, leave, contracts, documents, ops] = await Promise.all([
    employeeStats(user.tenantId),
    leaveCounts(user.tenantId),
    expiringContracts(user.tenantId),
    expiringDocuments(user.tenantId),
    hrOperationsCounts(user.tenantId),
  ]);

  return {
    headcount: stats.active,
    onLeaveToday: leave.onLeaveToday,
    activeOnboarding: ops.activeCases,
    contractsExpiring: contracts.length,
    documentsExpiring: documents.length,
    equipmentIssued: ops.assetsAssigned,
    expiryWindowDays: EXPIRY_WINDOW_DAYS,
  };
}
