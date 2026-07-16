/**
 * Carriage panel (Phase 7.5A) — customer-safe vessel/flight, references (BL/AWB) and the
 * container/ULD list for a portal shipment. Presentational; all values are already customer-safe
 * (no internal IDs, provider refs, or staff identity). Server component.
 */
import type { PortalCarriage } from "@/lib/portal/carriage";

const STATUS_TONE: Record<string, string> = {
  LOADED: "bg-teal-50 text-teal-700", ON_VESSEL: "bg-teal-50 text-teal-700", DELIVERED: "bg-teal-50 text-teal-700",
  DISCHARGED: "bg-sky-50 text-sky-700", GATE_OUT: "bg-sky-50 text-sky-700",
};

export function CarriagePanel({ carriage }: { carriage: PortalCarriage }) {
  const icon = carriage.mode === "SEA" ? "🚢" : "✈️";
  return (
    <section className="surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden>{icon}</span>
        <h2 className="text-sm font-semibold text-navy-900">{carriage.transportLabel}</h2>
        {carriage.milestoneLabel && <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">{carriage.milestoneLabel}</span>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        {carriage.carrierOrVessel && (
          <div><dt className="text-xs text-slate-400">{carriage.mode === "SEA" ? "Navire" : "Vol"}</dt><dd className="font-medium text-navy-800">{carriage.carrierOrVessel}</dd></div>
        )}
        {carriage.voyageOrFlight && (
          <div><dt className="text-xs text-slate-400">Voyage</dt><dd className="font-medium text-navy-800">{carriage.voyageOrFlight}</dd></div>
        )}
        {carriage.references.map((r) => (
          <div key={r.label}><dt className="text-xs text-slate-400">{r.label}</dt><dd className="tabular font-medium text-navy-800">{r.value}</dd></div>
        ))}
      </dl>

      {carriage.units.items.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{carriage.units.heading} ({carriage.units.items.length})</h3>
          <ul className="flex flex-wrap gap-2">
            {carriage.units.items.map((u) => (
              <li key={u.label} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs">
                <span className="tabular font-medium text-navy-800">{u.label}</span>
                {u.type && <span className="ml-1 text-slate-400">{u.type}</span>}
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_TONE[u.status] ?? "bg-slate-100 text-slate-500"}`}>{u.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
