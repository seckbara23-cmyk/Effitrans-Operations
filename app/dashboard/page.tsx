import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { kpis } from "@/lib/mock-data";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Panel } from "@/components/ui/panel";
import { ShipmentsTable } from "@/components/dashboard/shipments-table";
import { CustomsTable } from "@/components/dashboard/customs-table";
import { TasksTable } from "@/components/dashboard/tasks-table";
import { IconShip } from "@/lib/icons";

export const metadata: Metadata = {
  title: t.dashboard.title,
};

const d = t.dashboard;

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
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">{d.period}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {d.title}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-300">{d.subtitle}</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600/30 text-teal-200">
              <IconShip className="h-6 w-6" />
            </span>
            <div className="leading-tight">
              <p className="text-xs text-slate-300">Port de Dakar</p>
              <p className="text-sm font-semibold text-white">
                Opérations en cours
              </p>
            </div>
          </div>
        </div>
      </section>

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
