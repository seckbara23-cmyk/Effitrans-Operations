/**
 * Transport readiness panel (Phase 5.0D-5, Deliverable 2).
 * ---------------------------------------------------------------------------
 * Flag-gated; 404s with the workspaces flag off.
 *
 * DRIVER PRIVACY: the panel shows the CUSTOMER-SAFE contact — the tenant's
 * business number by default. A driver's personal number is never the customer
 * contact unless management explicitly opts in, and the panel says which policy is
 * in force so nobody has to guess.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getTransportPanel } from "@/lib/process/panels/transport";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Préparation transport" };

const FRESHNESS_FR: Record<string, string> = {
  live: "Position à jour",
  stale: "Position ancienne",
  offline: "Hors ligne",
  none: "Aucune position",
};

const POLICY_FR: Record<string, string> = {
  business: "Contact professionnel",
  masked: "Contact non configuré",
  driver_direct: "Numéro du chauffeur (autorisé par la direction)",
};

export default async function TransportReadinessPage() {
  if (!globalKillSwitch().workspaces) notFound();

  const user = await requireUser();
  if (!(await getTenantProcessFlags(user.tenantId)).workspaces) notFound();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) notFound();

  const panel = await getTransportPanel(user.tenantId, permissions);

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Préparation transport</h1>
        <p className="text-sm text-slate-600">
          {panel.total} transport(s) · porte de convergence, suivi et bordereau signé ·{" "}
          {panel.telemetry.queries} requêtes (lecture groupée)
        </p>
      </header>

      {panel.rows.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucun transport en cours.
        </div>
      )}

      <div className="space-y-2">
        {panel.rows.map((r) => (
          <article key={r.fileId} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/files/${r.fileId}`} className="tabular text-sm font-medium text-navy-900 hover:text-teal-700">
                  {r.fileNumber}
                </Link>
                <span className="ml-2 text-xs text-slate-500">{r.clientName}</span>
                <div className="text-xs text-slate-500">{r.transportStatus}</div>
              </div>

              <div className="text-right text-xs">
                <span
                  className={`rounded px-2 py-0.5 font-medium ${
                    r.pickupGate.ready
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {r.pickupGate.ready ? "Enlèvement autorisé" : "Enlèvement bloqué"}
                </span>
                <div className="mt-1 text-slate-500">{r.nextAction}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div>
                <p className="font-medium text-slate-700">Attelage</p>
                <p className="text-slate-600">
                  {r.vehicleAssigned ? `Véhicule ${r.vehiclePlate}` : "❌ Véhicule non affecté"}
                </p>
                <p className="text-slate-600">
                  {r.driverAssigned ? `Chauffeur ${r.driverName ?? "affecté"}` : "❌ Chauffeur non affecté"}
                </p>
                {/* The customer-safe contact — never a personal number by default. */}
                <p className="text-slate-500">
                  Contact client : {r.driverContact.customerSafeContact ?? "—"}
                </p>
                <p className="text-[10px] text-slate-400">{POLICY_FR[r.driverContact.policy]}</p>
              </div>

              <div>
                <p className="font-medium text-slate-700">Suivi</p>
                <p className="text-slate-600">
                  {r.trackingLinkReady ? "Lien de suivi disponible" : "Lien de suivi indisponible"}
                </p>
                <p className="text-slate-600">{FRESHNESS_FR[r.freshness]}</p>
                <p className="text-slate-600">
                  Douane : {r.customsReady ? "prête" : "non libérée"}
                </p>
              </div>

              <div>
                <p className="font-medium text-slate-700">Porte de convergence</p>
                <ul className="space-y-0.5">
                  {r.pickupGate.requirements.map((req) => (
                    <li
                      key={req.key}
                      className={
                        req.notApplicable
                          ? "text-slate-400"
                          : req.satisfied
                            ? "text-emerald-700"
                            : "text-red-600"
                      }
                    >
                      {req.notApplicable ? "—" : req.satisfied ? "✅" : "❌"} {req.labelFr}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-slate-600">
                  Bordereau signé : {r.podApproved ? "reçu" : "manquant"}
                  {r.podHandedOff && " · remis au Coordinateur"}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
