import { t } from "@/lib/i18n";
import { formatShortDate } from "@/lib/portal/shipment-view";
import type { PortalEta, EtaConfidence } from "@/lib/portal/eta";

const CONF_STYLE: Record<EtaConfidence, string> = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-rose-500" };

/** Estimated-delivery widget (Phase 3.3A D8). Conservative — explains its basis. */
export function EtaWidget({ eta }: { eta: PortalEta }) {
  const E = t.portal.premium.eta;
  const basis = (E.basis as Record<string, string>)[eta.basis] ?? "";
  const width = `${Math.max(8, eta.confidencePercent)}%`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-lg" aria-hidden>🕒</span>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{E.title}</p>
          <p className="tabular text-lg font-bold text-navy-900">{eta.estimatedDate ? formatShortDate(eta.estimatedDate) : E.none}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        {eta.estimatedDate && (
          <div>
            <div className="mb-1 flex items-center justify-between text-slate-500">
              <span>{E.confidence}</span>
              <span className="font-medium text-navy-800">{E[eta.confidence]}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${CONF_STYLE[eta.confidence]}`} style={{ width }} />
            </div>
          </div>
        )}
        {eta.delayDays > 0 && (
          <p className="font-medium text-rose-600">{E.delay}: {eta.delayDays} {E.days}</p>
        )}
        <p className="text-slate-500">{basis}</p>
      </div>
    </div>
  );
}
