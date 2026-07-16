import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getOceanShipmentDetail } from "@/lib/shipping/intelligence/service";
import { milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";
import { freshnessLabel } from "@/lib/shipping/intelligence/freshness";
import { ManualEventForm } from "@/components/shipping/manual-event-form";

export const metadata: Metadata = { title: "Expédition maritime" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">{label}</dt><dd className="tabular text-right font-medium text-navy-800">{value}</dd></div>;
}

const CONF_STYLE: Record<string, string> = {
  CONFIRMED: "bg-teal-50 text-teal-700", INFERRED: "bg-amber-50 text-amber-700", MANUAL: "bg-sky-50 text-sky-700", ESTIMATED: "bg-slate-100 text-slate-500",
};

export default async function ShipmentDetailPage({ params }: { params: { shipmentId: string } }) {
  const header = <PageHeader meta="Maritime" title="Expédition" subtitle="Jalon canonique, position, journal et fournisseur." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) notFound();

  const detail = await getOceanShipmentDetail(params.shipmentId);
  if (!detail) notFound();

  const { shipment: s, containers, timeline, position, map, customs, provider, nextMilestones } = detail;
  const canWrite = hasPermission(permissions, "transport:update");

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/shipping/shipments" className="text-teal-700 hover:underline">← Expéditions</Link>
        {s.fileNumber && <><span className="text-slate-300">·</span><Link href={`/files/${s.fileId}`} className="text-navy-700 hover:text-teal-700">Dossier {s.fileNumber}</Link></>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-medium text-navy-700">{milestoneLabel(s.milestone)}</span>
            <span className="text-xs text-slate-500">Fournisseur : {provider.displayName}</span>
            {customs.present && <span className={`text-xs ${customs.released ? "text-teal-700" : customs.blocked ? "text-red-700" : "text-slate-500"}`}>Douane : {customs.released ? "mainlevée" : customs.blocked ? "bloquée" : (customs.canonicalStatus ?? "en cours")}</span>}
          </div>
          <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
            <Row label="Client" value={s.clientName ?? "—"} />
            <Row label="Transporteur" value={s.carrierName ?? "—"} />
            <Row label="Réservation" value={s.bookingReference ?? "—"} />
            <Row label="Master BL" value={s.masterBl ?? "—"} />
            <Row label="House BL" value={s.houseBl ?? "—"} />
            <Row label="Trajet" value={`${s.origin ?? "—"} → ${s.destination ?? "—"}`} />
            <Row label="Départ prévu" value={s.plannedDeparture?.slice(0, 10) ?? "—"} />
            <Row label="ETA" value={s.estimatedArrival?.slice(0, 10) ?? "—"} />
          </dl>
        </div>

        {/* Current position — source/confidence/freshness always shown. */}
        <div className="surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Position actuelle</h2>
          {position.available ? (
            <>
              <Row label="Lieu" value={position.locationLabel ?? "—"} />
              <Row label="Source" value={position.source} />
              <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">Confiance</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONF_STYLE[position.confidence]}`}>{position.confidence}</span></dd></div>
              <Row label="Fraîcheur" value={freshnessLabel(position.freshness)} />
              <Row label="Constatée" value={position.occurredAt?.slice(0, 16).replace("T", " ") ?? "—"} />
            </>
          ) : (
            <p className="text-xs text-slate-500">{position.explanation}</p>
          )}
          {map.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-700">{map.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
          )}
          <p className="mt-2 text-xs text-slate-400">Carte interactive : projection prête (fournisseur cartographique Leaflet/OSM disponible).</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Journal (immuable)</h2>
          {timeline.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun évènement enregistré.</p>
          ) : (
            <ol className="space-y-2">
              {[...timeline].reverse().map((e, i) => (
                <li key={`${e.fingerprint}-${i}`} className="flex items-start gap-3 text-sm">
                  <span className="tabular mt-0.5 w-28 shrink-0 text-xs text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="flex-1">
                    <span className="font-medium text-navy-800">{milestoneLabel(e.eventType as ShippingMilestone)}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      <span className={`rounded px-1.5 py-0.5 ${CONF_STYLE[e.confidence]}`}>{e.confidence}</span>
                      <span className="ml-1">{e.source}</span>
                      {e.location?.name ? ` · ${e.location.name}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-4">
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Conteneurs ({containers.length})</h2>
            {containers.length === 0 ? (
              <p className="text-xs text-slate-500">Aucun conteneur enregistré.</p>
            ) : (
              <ul className="space-y-1">
                {containers.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-xs">
                    <span className="tabular font-medium text-navy-800">{c.number}</span>
                    <span className="text-slate-500">{c.isoType ?? "—"} · {c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseur</h2>
            <Row label="Fournisseur" value={provider.displayName} />
            <Row label="État" value={provider.status === "configured" ? "Actif" : "Non connecté"} />
            <Row label="Dernière synchro" value={s.trackingSyncedAt?.slice(0, 16).replace("T", " ") ?? "—"} />
            {provider.status === "unsupported" && provider.requiredInputs.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <p className="mb-1 font-semibold">Connexion transporteur bloquée — prérequis :</p>
                <ul className="list-inside list-disc space-y-0.5">{provider.requiredInputs.slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {canWrite && <ManualEventForm shipmentId={s.id} options={nextMilestones} />}
    </div>
  );
}
