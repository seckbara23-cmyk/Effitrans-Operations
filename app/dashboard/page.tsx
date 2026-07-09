import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFileOverview, getRecentFiles } from "@/lib/files/service";
import { getPresenceSummary } from "@/lib/users/service";
import { AdminPresenceCard } from "@/components/dashboard/admin-presence-card";
import type { PresenceSummary } from "@/lib/users/types";
import { getDepartmentCards } from "@/lib/departments/dashboard";
import type { DepartmentCardData } from "@/lib/departments/dashboard-map";
import { DepartmentCards } from "@/components/dashboard/department-cards";
import { getRecentActivity, type ActivityItem } from "@/lib/activity/feed";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { getControlTower, type ControlTowerData } from "@/lib/control-tower/service";
import { ControlTower } from "@/components/dashboard/control-tower";
import { getDashboardTasks } from "@/lib/tasks/service";
import { DakarClock } from "@/components/dashboard/dakar-clock";
import { DashboardKpis } from "@/components/dashboard/dashboard-kpis";
import { DashboardTasks } from "@/components/dashboard/dashboard-tasks";
import { DashboardRecentFiles } from "@/components/dashboard/dashboard-recent-files";
import { DashboardBreakdown } from "@/components/dashboard/dashboard-breakdown";
import { DashboardFinanceKpis } from "@/components/dashboard/dashboard-finance-kpis";
import { IconShip, IconPlane, IconRoute } from "@/lib/icons";

export const metadata: Metadata = {
  title: t.dashboard.title,
};

// Reads per-request operational data (auth) — never prerender.
export const dynamic = "force-dynamic";

const d = t.dashboard;

/** Operational footprint shown as status chips in the hero band. */
const footprint: { label: string; icon: typeof IconShip }[] = [
  { label: "Port de Dakar", icon: IconShip },
  { label: "AIBD", icon: IconPlane },
  { label: "Sénégal ↔ Mali", icon: IconRoute },
  { label: "Sénégal ↔ Guinée", icon: IconRoute },
  { label: "Sénégal ↔ Mauritanie", icon: IconRoute },
];

export default async function DashboardPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  // Fetch once, here, with graceful degradation: each section renders only for
  // the data the user is permitted to see (file:read / task:read enforced in
  // the service via assertPermission + tenant scope).
  let overview = null;
  let recent: Awaited<ReturnType<typeof getRecentFiles>> = [];
  let dashTasks = null;
  let presence: PresenceSummary | null = null;
  let deptCards: DepartmentCardData[] = [];
  let activity: ActivityItem[] = [];
  let canSeeActivity = false;
  let controlTower: ControlTowerData | null = null;
  if (configured) {
    const user = await requireUser();
    // Stage 1 — session-light counts + the permission set are all independent,
    // so resolve them in ONE round of concurrent queries (permissions was
    // previously awaited separately, serialising it after the counts).
    let permissions: string[] = [];
    [overview, recent, dashTasks, permissions] = await Promise.all([
      getFileOverview().catch(() => null),
      getRecentFiles(8).catch(() => []),
      getDashboardTasks().catch(() => null),
      getEffectivePermissions(user.id).catch(() => [] as string[]),
    ]);
    canSeeActivity = hasPermission(permissions, "audit:read:all");
    // Stage 2 — the four heavy dashboard sections are mutually independent.
    // Fetch them concurrently: previously each was awaited in turn, so the
    // dashboard's wall time was the SUM of control tower + department cards +
    // activity + presence. Each stays permission-gated exactly as before and
    // still degrades to its default on failure.
    [controlTower, deptCards, activity, presence] = await Promise.all([
      // Phase 2.2 — operations control tower (management view).
      hasPermission(permissions, "analytics:read")
        ? getControlTower(permissions).catch(() => null)
        : Promise.resolve<ControlTowerData | null>(null),
      // Dashboard UX — department workload cards (only depts the viewer can read).
      getDepartmentCards(permissions).catch(() => []),
      // Recent activity — broad visibility (audit:read:all via RLS), finance-filtered.
      canSeeActivity
        ? getRecentActivity(hasPermission(permissions, "finance:read")).catch(() => [])
        : Promise.resolve<ActivityItem[]>([]),
      // Phase 2.1A — SYSTEM_ADMIN-only presence summary.
      hasPermission(permissions, "admin:users:manage")
        ? getPresenceSummary().catch(() => null)
        : Promise.resolve<PresenceSummary | null>(null),
    ]);
  }
  const taskKpis = dashTasks
    ? { dueToday: dashTasks.today.length, overdue: dashTasks.overdue.length, mine: dashTasks.mine.length }
    : null;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Identity hero band — Port of Dakar control strip */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7 sm:py-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:28px_28px] opacity-60" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div
          className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-teal-600/20 blur-2xl"
          aria-hidden
        />
        <div className="relative">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="eyebrow text-teal-300">
                <DakarClock />
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                {d.title}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-slate-300">
                {d.subtitle}
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-400" />
              </span>
              <div className="leading-tight">
                <p className="text-xs text-slate-300">Réseau opérationnel</p>
                <p className="text-sm font-semibold text-white">
                  Sénégal · Afrique de l'Ouest
                </p>
              </div>
            </div>
          </div>

          {/* Operational footprint — ports, hubs and transit corridors */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {footprint.map((f) => {
              const Icon = f.icon;
              return (
                <span
                  key={f.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 backdrop-blur"
                >
                  <Icon className="h-3.5 w-3.5 text-teal-300" />
                  {f.label}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Real KPI band (Phase 1.5) — live dossier + task counts */}
      <DashboardKpis files={overview} tasks={taskKpis} />

      {/* Operations control tower (Phase 2.2) — management view (analytics:read) */}
      {controlTower && <ControlTower data={controlTower} />}

      {/* Department workload cards (Dashboard UX) — per-department, permission-scoped */}
      <DepartmentCards cards={deptCards} />

      {/* Recent activity (Dashboard UX) — broad-visibility roles only */}
      {canSeeActivity && <RecentActivity items={activity} />}

      {/* Presence summary (Phase 2.1A) — SYSTEM_ADMIN / admin:users:manage only */}
      {presence && <AdminPresenceCard summary={presence} />}

      {/* Finance KPIs (Phase 1.11) — only for finance-role users */}
      <DashboardFinanceKpis />

      {/* Today's work — real tasks (Overdue / Today / Mine) */}
      <DashboardTasks data={dashTasks} />

      {/* Recent dossiers — real operational_file rows */}
      <DashboardRecentFiles files={recent} />

      {/* Status + transport-mode breakdowns */}
      <DashboardBreakdown overview={overview} />
    </div>
  );
}
