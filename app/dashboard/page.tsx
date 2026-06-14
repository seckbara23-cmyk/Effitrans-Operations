import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { kpis } from "@/lib/mock-data";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Panel } from "@/components/ui/panel";
import { ShipmentsTable } from "@/components/dashboard/shipments-table";
import { CustomsTable } from "@/components/dashboard/customs-table";
import { TasksTable } from "@/components/dashboard/tasks-table";
import { DakarClock } from "@/components/dashboard/dakar-clock";
import { DashboardTasks } from "@/components/dashboard/dashboard-tasks";
import { IconShip, IconPlane, IconRoute } from "@/lib/icons";

export const metadata: Metadata = {
  title: t.dashboard.title,
};

// Real Tasks section reads per-request data (auth) — never prerender.
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

export default function DashboardPage() {
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

      {/* Real operational tasks (Phase 1.3) — above the mock control-tower */}
      <DashboardTasks />

      {/* KPI grid */}
      <section>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      </section>

      {/* Recent shipments — full width */}
      <Panel
        eyebrow="Suivi"
        title={d.panels.recentShipments}
        action={{ label: d.panels.viewAll, href: "/shipments" }}
      >
        <ShipmentsTable />
      </Panel>

      {/* Customs queue + tasks */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Douane"
          title={d.panels.customsQueue}
          action={{ label: d.panels.viewAll, href: "/customs" }}
        >
          <CustomsTable />
        </Panel>
        <Panel
          eyebrow="Planning"
          title={d.panels.tasksToday}
          action={{ label: d.panels.viewAll, href: "/tasks" }}
        >
          <TasksTable />
        </Panel>
      </div>
    </div>
  );
}
