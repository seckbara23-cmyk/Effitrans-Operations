import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listFleet, listVehicleMaintenance, summarizeFleet } from "@/lib/fleet/service";
import { FleetConsole } from "@/components/fleet/fleet-console";

export const metadata: Metadata = { title: "Parc & Flotte" };
export const dynamic = "force-dynamic";

const TYPE_FR: Record<string, string> = {
  CAMION: "Camion", CAMIONNETTE: "Camionnette", VOITURE: "Voiture",
  TRACTEUR: "Tracteur", REMORQUE: "Remorque", AUTRE: "Autre",
};
const COMPLIANCE_FR: Record<string, string> = {
  ASSURANCE: "Assurance", VISITE_TECHNIQUE: "Visite technique", CARTE_GRISE: "Carte grise",
  LICENCE_TRANSPORT: "Licence de transport", VIGNETTE: "Vignette", AUTRE: "Autre",
};
const EXPIRY_FR: Record<string, string> = {
  expired: "Expirée", expiring: "Expire bientôt", valid: "Valide", none: "Non renseignée",
};
const EXPIRY_TONE: Record<string, string> = {
  expired: "bg-red-50 text-red-700", expiring: "bg-amber-50 text-amber-700",
  valid: "bg-teal-50 text-teal-700", none: "bg-slate-100 text-slate-500",
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-navy-900"}`}>{value}</p>
    </div>
  );
}

export default async function ParcPage() {
  const header = (
    <PageHeader
      meta="Transport"
      title="Parc & Flotte"
      subtitle="Véhicules de l'entreprise : disponibilité, conformité et interventions."
    />
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div></div>;
  }
  const canManage = hasPermission(permissions, "transport:manage");

  const fleet = await listFleet();
  const overview = summarizeFleet(fleet);
  // TMS-5A — TMS-5 built listVehicleMaintenance and never rendered it, so the
  // intervention history (« historique des interventions », including the
  // return to service) was unreachable. Loaded for the vehicles on screen.
  const histories = await Promise.all(
    fleet.map(async (v) => [v.id, await listVehicleMaintenance(v.id)] as const),
  );
  const historyByVehicle = new Map(histories);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <Link href="/transport" className="text-sm text-teal-700 hover:underline">← Opérations de transport</Link>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Véhicules" value={overview.total} />
        <Stat label="Disponibles" value={overview.available} tone="text-teal-700" />
        <Stat label="En mission" value={overview.engaged} tone="text-navy-800" />
        <Stat label="En maintenance" value={overview.maintenance} tone="text-amber-700" />
        <Stat label="Hors service" value={overview.outOfService} tone="text-slate-500" />
        <Stat
          label="Conformité à surveiller"
          value={overview.complianceExpiring + overview.complianceExpired}
          tone={overview.complianceExpired > 0 ? "text-red-700" : "text-amber-700"}
        />
      </div>

      {fleet.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun véhicule enregistré. {canManage ? "Ajoutez le premier véhicule ci-dessous." : "Un responsable Transport peut enregistrer les véhicules."}
        </div>
      ) : (
        <div className="surface overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Véhicule</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Capacité</th>
                <th className="px-4 py-2">État</th>
                <th className="px-4 py-2">Conformité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fleet.map((v) => (
                <tr key={v.id} className={v.isActive ? "" : "opacity-50"}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-navy-900">{v.registration}</span>
                    {v.internalCode && <span className="text-slate-500"> · {v.internalCode}</span>}
                    {(v.make || v.model) && (
                      <div className="text-xs text-slate-500">{[v.make, v.model, v.year].filter(Boolean).join(" ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{TYPE_FR[v.vehicleType] ?? v.vehicleType}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {[v.capacityKg ? `${v.capacityKg} kg` : null, v.capacityM3 ? `${v.capacityM3} m³` : null]
                      .filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-2">
                    {/* « En mission » is DERIVED from live transport records — it is
                        never stored on the vehicle, so it cannot drift. */}
                    {v.engaged ? (
                      <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-800">
                        En mission{v.engagedFileNumbers.length ? ` · ${v.engagedFileNumbers.join(", ")}` : ""}
                      </span>
                    ) : v.status === "AVAILABLE" ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">Disponible</span>
                    ) : v.status === "MAINTENANCE" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Maintenance</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Hors service</span>
                    )}
                    {!v.isActive && <span className="ml-1 text-xs text-slate-400">retiré</span>}
                  </td>
                  <td className="px-4 py-2">
                    {v.compliance.length === 0 ? (
                      <span className="text-xs text-slate-400">Non renseignée</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {v.compliance.map((c) => (
                          <span key={c.id} className={`rounded px-1.5 py-0.5 text-[11px] ${EXPIRY_TONE[c.expiryState]}`}>
                            {COMPLIANCE_FR[c.typeCode] ?? c.typeCode} : {EXPIRY_FR[c.expiryState]}
                            {c.expiresOn ? ` (${c.expiresOn})` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fleet.some((v) => (historyByVehicle.get(v.id) ?? []).length > 0) && (
        <section className="surface p-4">
          <h2 className="text-sm font-semibold text-navy-900">Historique des interventions</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Interventions planifiées et imprévues, immobilisations et remises en service.
          </p>
          <div className="mt-3 space-y-3">
            {fleet.map((v) => {
              const history = historyByVehicle.get(v.id) ?? [];
              if (history.length === 0) return null;
              return (
                <div key={v.id}>
                  <p className="text-xs font-medium text-slate-600">
                    {v.registration}{v.internalCode ? ` · ${v.internalCode}` : ""}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {history.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-600">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${m.status === "OPEN" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {m.status === "OPEN" ? "En cours" : "Clôturée"}
                        </span>
                        <span>{m.kind === "PLANNED" ? "Planifiée" : "Imprévue"}</span>
                        {m.immobilizing && <span className="text-slate-400">· immobilisante</span>}
                        <span className="text-slate-500">· ouverte le {m.openedOn}</span>
                        {m.closedOn && <span className="text-slate-500">· remise en service le {m.closedOn}</span>}
                        <span className="text-navy-800">— {m.description}</span>
                        {m.resolution && <span className="text-slate-500">({m.resolution})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {canManage ? (
        <FleetConsole vehicles={fleet} />
      ) : (
        /* TMS-5C — a reader is told WHY there are no controls, instead of
           meeting a wall of greyed-out buttons. */
        <p className="surface p-4 text-xs text-slate-500">
          Consultation seule : la modification du parc (ajout de véhicule, conformité, interventions,
          disponibilité) relève du Responsable Transport.
        </p>
      )}
    </div>
  );
}
