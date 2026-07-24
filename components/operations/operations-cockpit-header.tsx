import { DakarClock } from "@/components/dashboard/dakar-clock";
import { CockpitRefresh } from "./cockpit-refresh";
import { IconShip, IconPlane, IconRoute } from "@/lib/icons";

/**
 * Centre d'Opérations — hero header (Phase 10.0C, Scope A). Server component.
 * Recomposes the existing dashboard hero: title, subtitle, live Dakar clock
 * (existing established control), operational footprint, an on-demand refresh
 * action, and a TRUTHFUL last-rendered timestamp (server render time — no
 * "live"/"temps réel" language, no automatic polling).
 */
const FOOTPRINT: { label: string; icon: typeof IconShip }[] = [
  { label: "Port de Dakar", icon: IconShip },
  { label: "AIBD", icon: IconPlane },
  { label: "Sénégal ↔ Mali", icon: IconRoute },
  { label: "Sénégal ↔ Guinée", icon: IconRoute },
  { label: "Sénégal ↔ Mauritanie", icon: IconRoute },
];

export function OperationsCockpitHeader({
  title,
  subtitle,
  companyName,
  renderedAt,
}: {
  title: string;
  subtitle: string;
  companyName?: string | null;
  renderedAt: Date;
}) {
  const renderedLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Dakar",
  }).format(renderedAt);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7 sm:py-7">
      <div className="absolute inset-0 bg-chart-grid bg-[size:28px_28px] opacity-60" />
      <div className="absolute inset-0 bg-container-hatch" />
      <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-teal-600/20 blur-2xl" aria-hidden />
      <div className="relative">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">
              <DakarClock />
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-300">{subtitle}</p>
            {companyName && <p className="mt-1 text-xs font-medium text-teal-200">{companyName}</p>}
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-400" />
              </span>
              <div className="leading-tight">
                <p className="text-xs text-slate-300">Réseau opérationnel</p>
                <p className="text-sm font-semibold text-white">Sénégal · Afrique de l'Ouest</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span>Dernière actualisation : {renderedLabel}</span>
              <CockpitRefresh className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-medium text-white transition hover:border-teal-300 hover:bg-white/10 disabled:opacity-60" />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {FOOTPRINT.map((f) => {
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
  );
}
