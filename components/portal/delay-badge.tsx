import type { DelayState } from "@/lib/portal/tracking-derive";

const STYLE: Record<DelayState, string> = {
  normal: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  high: "bg-orange-50 text-orange-700 ring-orange-600/20",
  critical: "bg-rose-50 text-rose-700 ring-rose-600/20",
};
const DOT: Record<DelayState, string> = {
  normal: "bg-emerald-500",
  warning: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-rose-500",
};

/** Customer-safe shipment status badge (Phase 3.3A D6). */
export function DelayBadge({ state, label }: { state: DelayState; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[state]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[state]}`} aria-hidden />
      {label}
    </span>
  );
}
