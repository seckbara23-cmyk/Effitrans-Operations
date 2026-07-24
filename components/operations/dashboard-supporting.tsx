import { hasPermission } from "@/lib/rbac/permissions";
import { getDashboardTasks } from "@/lib/tasks/service";
import { getControlTower } from "@/lib/control-tower/service";
import { getDepartmentCards } from "@/lib/departments/dashboard";
import { getRecentActivity } from "@/lib/activity/feed";
import { getPresenceSummary } from "@/lib/users/service";
import { getRecentFiles } from "@/lib/files/service";
import { DashboardTasks } from "@/components/dashboard/dashboard-tasks";
import { ControlTower } from "@/components/dashboard/control-tower";
import { DepartmentCards } from "@/components/dashboard/department-cards";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { AdminPresenceCard } from "@/components/dashboard/admin-presence-card";
import { DashboardRecentFiles } from "@/components/dashboard/dashboard-recent-files";

/**
 * Centre d'Opérations — preserved supporting sections (Phase 10.0C). Async SERVER
 * component. These sections have NO equivalent in the cockpit view model yet, so
 * they are PRESERVED verbatim through their existing readers (no silent removal —
 * see the disposition table in the phase report). getControlTower / getDashboardTasks
 * are the cache()-wrapped readers the cockpit already used, so this adds no re-read.
 * Every section is permission-gated and degrades independently on failure.
 */
export async function DashboardSupporting({ permissions }: { permissions: string[] }) {
  const canAnalytics = hasPermission(permissions, "analytics:read");
  const canActivity = hasPermission(permissions, "audit:read:all");
  const canPresence = hasPermission(permissions, "admin:users:manage");
  const canFinance = hasPermission(permissions, "finance:read");

  const [tasks, controlTower, deptCards, activity, presence, recent] = await Promise.all([
    getDashboardTasks().catch(() => null),
    canAnalytics ? getControlTower(permissions).catch(() => null) : Promise.resolve(null),
    getDepartmentCards(permissions).catch(() => []),
    canActivity ? getRecentActivity(canFinance).catch(() => []) : Promise.resolve([]),
    canPresence ? getPresenceSummary().catch(() => null) : Promise.resolve(null),
    getRecentFiles(8).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <DashboardTasks data={tasks} />
      {controlTower && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-navy-900">Analyse de direction</h2>
          <ControlTower data={controlTower} />
        </div>
      )}
      <DepartmentCards cards={deptCards} />
      {canActivity && <RecentActivity items={activity} />}
      {presence && <AdminPresenceCard summary={presence} />}
      <DashboardRecentFiles files={recent} />
    </div>
  );
}
