/**
 * TMS-2 — Transport → Suivi en direct. The live tracking control centre.
 *
 * Gate: `transport:read`. A DRIVER holds `tracking:read` but NOT
 * `transport:read`, so the tracked driver cannot reach the fleet-wide map —
 * §15 enforced by the same authority the rest of Transport uses, with no new
 * role invented.
 *
 * Telemetry only. Nothing on this page advances a mission, records a delivery,
 * creates a POD or closes a dossier: the official process stays authoritative,
 * and the page says so where an operator can read it.
 */
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listLiveMissions, summarizeLiveMissions, countSessionsEndedToday } from "@/lib/tracking/live-service";
import { MISSION_LEG_LABEL_FR } from "@/lib/tracking/types";
import { trackingEnabled } from "@/lib/tracking/config";
import { LiveRefresh } from "@/components/transport/live-refresh";

export const metadata: Metadata = { title: "Suivi en direct" };
export const revalidate = 0;

// Client-only: no map code ships on pages without a map.
const TransportLiveMap = dynamic(
  () => import("@/components/transport/live-map").then((m) => m.TransportLiveMap),
  { ssr: false, loading: () => <div className="surface p-6 text-sm text-slate-500">Chargement de la carte…</div> },
);

/** Operator-facing freshness wording. Never says « en direct » for an old fix. */
const HEALTH_FR: Record<string, { label: string; tone: string }> = {
  live: { label: "En direct", tone: "bg-teal-50 text-teal-700" },
  stale: { label: "Signal ancien", tone: "bg-amber-50 text-amber-700" },
  offline: { label: "Signal perdu", tone: "bg-red-50 text-red-700" },
  paused: { label: "Suivi en pause", tone: "bg-slate-100 text-slate-500" },
  completed: { label: "Terminé", tone: "bg-slate-100 text-slate-500" },
  not_started: { label: "Suivi non démarré", tone: "bg-slate-100 text-slate-500" },
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-navy-900"}`}>{value}</p>
    </div>
  );
}

function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

export default async function TransportLiveTrackingPage() {
  const header = (
    <PageHeader
      meta="Transport"
      title="Suivi en direct"
      subtitle="Missions, chauffeurs et véhicules suivis en temps réel."
    />
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>
      </div>
    );
  }

  const now = new Date();
  const [missions, endedToday] = await Promise.all([listLiveMissions(), countSessionsEndedToday()]);
  const kpis = summarizeLiveMissions(missions, endedToday);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/transport" className="text-sm text-teal-700 hover:underline">← Opérations de transport</Link>
        <LiveRefresh />
      </div>

      {!trackingEnabled() && (
        <div className="surface border-l-4 border-amber-300 p-4 text-xs text-amber-800">
          Le suivi GPS est désactivé sur cet environnement. Les chauffeurs ne peuvent pas démarrer
          de mission tant que la fonctionnalité n&apos;est pas activée.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Missions suivies" value={kpis.tracked} />
        <Stat label="En livraison" value={kpis.outbound} tone="text-teal-700" />
        <Stat label="En retour" value={kpis.returning} tone="text-navy-800" />
        <Stat label="Signal ancien / perdu" value={kpis.staleOrOffline} tone={kpis.staleOrOffline > 0 ? "text-red-700" : undefined} />
        <Stat label="Terminées aujourd'hui" value={kpis.endedToday} tone="text-slate-500" />
      </div>

      {/* TMS-2D — the map is PERMANENT. It renders with zero missions, carrying
          its own empty-state card and a documented fallback viewport; only the
          telemetry on it changes. It is deliberately outside the conditional
          below, which governs the mission LIST alone. */}
      <TransportLiveMap missions={missions} />

      {missions.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucune mission suivie actuellement. Le suivi démarre lorsqu&apos;un chauffeur ouvre sa
          mission et appuie sur « Démarrer la mission ».
        </div>
      ) : (
        <div className="surface overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Véhicule / chauffeur</th>
                <th className="px-4 py-2">Dossier</th>
                <th className="px-4 py-2">Phase</th>
                <th className="px-4 py-2">Dernière position</th>
                <th className="px-4 py-2">Trajet</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {missions.map((m) => {
                const h = HEALTH_FR[m.health] ?? HEALTH_FR.not_started;
                return (
                  <tr key={m.transportId}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-navy-900">{m.vehicleLabel ?? "Véhicule non renseigné"}</span>
                      {m.driverName && <span className="text-slate-600"> — {m.driverName}</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{m.fileNumber}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.leg === "RETURN" ? "bg-navy-50 text-navy-800" : "bg-teal-50 text-teal-700"}`}>
                        {MISSION_LEG_LABEL_FR[m.leg]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.tone}`}>{h.label}</span>
                      <span className="ml-2 text-xs text-slate-500">{ago(m.lastPosition?.at, now)}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {[m.pickupLocation, m.deliveryLocation].filter(Boolean).join(" → ") || "—"}
                      {m.returnLocation ? <> → {m.returnLocation}</> : null}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/files/${m.fileId}#transport`} className="text-xs text-teal-700 hover:underline">
                        Ouvrir la mission →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="surface p-4 text-xs text-slate-500">
        Le suivi GPS est une aide à la visibilité. Il ne déclenche jamais un enlèvement, une
        livraison, un POD, une étape du processus officiel ni une clôture de dossier : ces actes
        restent gouvernés par le processus Effitrans.
      </p>
    </div>
  );
}
