import Link from "next/link";
import { t } from "@/lib/i18n";
import { relativeLabel } from "@/lib/portal/progress-map";
import { formatShortDate } from "@/lib/portal/shipment-view";
import { DelayBadge } from "./delay-badge";
import type { PortalShipmentCard } from "@/lib/portal/types";

const MODE_ICON: Record<string, string> = { SEA: "🚢", AIR: "✈️", ROAD: "🚚", MULTIMODAL: "🔀" };

function stageLabel(key: string | null): string {
  if (!key) return "—";
  return (t.portal.progress.stages as Record<string, string>)[key] ?? key;
}

/** Premium logistics shipment card (Phase 3.3 D1). Mobile-first. */
export function ShipmentCard({ s }: { s: PortalShipmentCard }) {
  const c = t.portal.premium.card;
  return (
    <Link
      href={`/portal/files/${s.id}`}
      className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg"
    >
      {/* header band */}
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-navy-900 to-teal-800 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="tabular text-sm font-bold tracking-tight">{s.fileNumber}</p>
          <p className="truncate text-[11px] text-teal-100">
            {c.reference}: {s.reference ?? "—"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">
          <span aria-hidden>{MODE_ICON[s.transportMode ?? ""] ?? "📦"}</span>{" "}
          {t.files.types[s.type as keyof typeof t.files.types] ?? s.type}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* route */}
        <div className="flex items-center gap-1.5 text-sm font-medium text-navy-900">
          <span aria-hidden className="text-teal-500">📍</span>
          <span className="truncate">{s.routeDisplay}</span>
        </div>

        {/* progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-navy-800">{stageLabel(s.currentStageKey)}</span>
            <span className="tabular text-slate-500">{s.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-600 transition-all" style={{ width: `${s.percent}%` }} />
          </div>
        </div>

        {/* meta grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <p className="text-slate-400">{c.officer}</p>
            <p className="truncate font-medium text-navy-800">{s.officerName ?? c.noOfficer}</p>
          </div>
          <div>
            <p className="text-slate-400">{c.eta}</p>
            <p className="tabular font-medium text-navy-800">{s.eta ? formatShortDate(s.eta) : c.noEta}</p>
          </div>
          <div>
            <p className="text-slate-400">{c.lastActivity}</p>
            <p className="font-medium text-navy-800">{relativeLabel(s.lastActivity, new Date())}</p>
          </div>
          <div className="flex items-end">
            <DelayBadge state={s.delayState} label={s.delayLabel} />
          </div>
        </div>

        {/* next step */}
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.nextStep}</p>
          <p className="text-xs font-medium text-navy-800">{s.nextStepTitle}</p>
        </div>

        <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 group-hover:gap-2">
          {c.open} <span aria-hidden className="transition-all">→</span>
        </span>
      </div>
    </Link>
  );
}
