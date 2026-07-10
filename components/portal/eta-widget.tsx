import { t } from "@/lib/i18n";
import { formatShortDate, type PortalEta } from "@/lib/portal/shipment-view";

const CONF_STYLE: Record<PortalEta["confidence"], string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
};
const CONF_WIDTH: Record<PortalEta["confidence"], string> = {
  high: "w-full",
  medium: "w-2/3",
  low: "w-1/3",
};

/** Estimated-delivery widget (Phase 3.3 D10). Derived from existing SLA/transport data. */
export function EtaWidget({ eta }: { eta: PortalEta }) {
  const E = t.portal.premium.eta;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-lg" aria-hidden>🕒</span>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{E.title}</p>
          <p className="tabular text-lg font-bold text-navy-900">
            {eta.estimated ? formatShortDate(eta.estimated) : E.none}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <div>
          <div className="mb-1 flex items-center justify-between text-slate-500">
            <span>{E.confidence}</span>
            <span className="font-medium text-navy-800">{E[eta.confidence]}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${CONF_STYLE[eta.confidence]} ${CONF_WIDTH[eta.confidence]}`} />
          </div>
        </div>
        {eta.delayDays > 0 && (
          <p className="font-medium text-rose-600">
            {E.delay}: {eta.delayDays} {E.days}
          </p>
        )}
        <p className="text-slate-500">{E.reasons[eta.reasonKey]}</p>
      </div>
    </div>
  );
}
