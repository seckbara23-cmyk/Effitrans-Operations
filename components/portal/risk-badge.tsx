import { t } from "@/lib/i18n";
import type { PortalRiskLevel } from "@/lib/portal/shipment-view";

const STYLE: Record<PortalRiskLevel, string> = {
  on_track: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  attention: "bg-amber-50 text-amber-700 ring-amber-600/20",
  delayed: "bg-rose-50 text-rose-700 ring-rose-600/20",
};
const DOT: Record<PortalRiskLevel, string> = {
  on_track: "bg-emerald-500",
  attention: "bg-amber-500",
  delayed: "bg-rose-500",
};

/** Customer-safe shipment health indicator (Phase 3.3). */
export function RiskBadge({ risk }: { risk: PortalRiskLevel }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[risk]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[risk]}`} aria-hidden />
      {t.portal.premium.risk[risk]}
    </span>
  );
}
