import Link from "next/link";
import type { DossierCarriage } from "@/lib/files/types";

/**
 * MAYA-P0.6-D — the dossier's own carriage units, read-only.
 *
 * Subordinate to the dossier by design: it identifies what is being carried and
 * stops there. Every management action — adding a container, moving it between
 * shipments, recording an event — stays in `/shipping`, which this panel links
 * to rather than reimplements.
 *
 * Nothing here classifies anything. `type` is the stored `iso_type` / `uld_type`
 * text rendered verbatim; there is deliberately no 20'/40' breakdown, because
 * that field carries no validated vocabulary to derive one from.
 */
export function CarriagePanel({ carriage, shipmentId }: {
  carriage: DossierCarriage;
  /**
   * TMS-3 — the dossier's OWN shipment, so the panel can deep-link into the
   * tracking studio instead of the generic workspace root (the surface always
   * existed; what was missing is reach).
   */
  shipmentId?: string | null;
}) {
  const studioHref = shipmentId
    ? `${carriage.mode === "SEA" ? "/shipping" : "/air"}/shipments/${shipmentId}`
    : "/shipping";
  const sea = carriage.mode === "SEA";
  const title = sea ? "Conteneurs" : "Colis aériens";

  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {carriage.total} {sea ? (carriage.total === 1 ? "conteneur" : "conteneurs") : carriage.total === 1 ? "ligne" : "lignes"}
        </span>
      </div>

      {carriage.units.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Aucune unité enregistrée pour cet acheminement.{" "}
          <Link href={studioHref} className="text-teal-700 hover:underline">
            {sea ? "Ouvrir le suivi maritime" : "Ouvrir le suivi aérien"}
          </Link>
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-slate-100">
            {carriage.units.map((u) => {
              // Only what this row actually holds — an absent fact is omitted,
              // never rendered as 0 or as an empty label.
              const facts = [
                u.pieceCount != null ? `${u.pieceCount} colis` : null, // « colis » is invariable
                u.weightKg != null ? `${u.weightKg} kg` : null,
                u.volumeM3 != null ? `${u.volumeM3} m³` : null,
                u.dimensions,
                u.specialHandling,
                u.dangerousGoods ? "Marchandises dangereuses" : null,
                u.temperatureControlled ? "Température dirigée" : null,
              ].filter(Boolean);

              return (
                <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-navy-900">{u.label ?? "—"}</span>
                    {u.type && <span className="ml-2 text-xs text-slate-500">{u.type}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
                    {facts.length > 0 && <span>{facts.join(" · ")}</span>}
                    {u.status && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{u.status}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">
            Information en lecture seule.{" "}
            <Link href={studioHref} className="text-teal-700 hover:underline">
              {sea ? "Ouvrir le suivi maritime" : "Ouvrir le suivi aérien"}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
