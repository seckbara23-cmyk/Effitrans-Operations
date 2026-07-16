import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAirShipmentDetail } from "@/lib/air/intelligence/service";
import { listFlightOptions } from "@/lib/air/intelligence/manage-service";
import { listDocuments } from "@/lib/documents/service";
import { airMilestoneLabel, type AirMilestone } from "@/lib/air/intelligence/milestones";
import { freshnessLabel } from "@/lib/shipping/intelligence/freshness";
import { ShipmentMapLoader } from "@/components/shipping/shipment-map-loader";
import { AirConsole } from "@/components/air/air-console";

export const metadata: Metadata = { title: "Expédition aérienne" };
export const dynamic = "force-dynamic";
const AIR_DOC_TYPES = ["BILL_OF_LADING", "AIRWAY_BILL", "BON_A_DELIVRER", "COMMERCIAL_INVOICE", "PACKING_LIST", "CERTIFICATE_OF_ORIGIN", "CUSTOMS_DECLARATION"];
const CONF: Record<string, string> = { CONFIRMED: "bg-teal-50 text-teal-700", INFERRED: "bg-amber-50 text-amber-700", MANUAL: "bg-sky-50 text-sky-700", ESTIMATED: "bg-slate-100 text-slate-500" };
function Row({ label, value }: { label: string; value: React.ReactNode }) { return <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">{label}</dt><dd className="tabular text-right font-medium text-navy-800">{value}</dd></div>; }

export default async function AirDetailPage({ params }: { params: { shipmentId: string } }) {
  const header = <PageHeader meta="Aérien" title="Expédition" subtitle="Jalon canonique, carte, journal, ULD et fournisseur." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) notFound();

  const detail = await getAirShipmentDetail(params.shipmentId);
  if (!detail) notFound();
  const canWrite = hasPermission(permissions, "transport:update");
  const [flights, documents] = await Promise.all([
    canWrite ? listFlightOptions() : Promise.resolve([]),
    hasPermission(permissions, "document:read") ? listDocuments(detail.shipment.fileId).catch(() => []) : Promise.resolve([]),
  ]);
  const { shipment: s, ulds, timeline, position, map, customs, provider, flightNumber } = detail;
  const lastEventAt = timeline.length ? timeline[timeline.length - 1].occurredAt : null;
  const docs = documents.filter((d) => AIR_DOC_TYPES.includes(d.typeCode));

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/air/shipments" className="text-teal-700 hover:underline">← Expéditions</Link>
        {s.fileNumber && <><span className="text-slate-300">·</span><Link href={`/files/${s.fileId}`} className="text-navy-700 hover:text-teal-700">Dossier {s.fileNumber}</Link></>}
        {customs.present && <><span className="text-slate-300">·</span><Link href="/customs/intelligence" className="text-navy-700 hover:text-teal-700">Douane</Link></>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-medium text-navy-700">{airMilestoneLabel(s.milestone)}</span>
            <span className="text-xs text-slate-500">Fournisseur : {provider.displayName}</span>
            {flightNumber && <span className="text-xs text-slate-500">Vol : {flightNumber}</span>}
            {customs.present && <span className={`text-xs ${customs.released ? "text-teal-700" : customs.blocked ? "text-red-700" : "text-slate-500"}`}>Douane : {customs.released ? "mainlevée" : customs.blocked ? "bloquée" : (customs.canonicalStatus ?? "en cours")}</span>}
          </div>
          <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
            <Row label="Client" value={s.clientName ?? "—"} />
            <Row label="MAWB" value={s.mawb ?? "—"} />
            <Row label="HAWB" value={s.hawb ?? "—"} />
            <Row label="Trajet" value={`${s.origin ?? "—"} → ${s.destination ?? "—"}`} />
            <Row label="Départ prévu" value={s.scheduledDeparture?.slice(0, 10) ?? "—"} />
            <Row label="ETA" value={s.estimatedArrival?.slice(0, 10) ?? "—"} />
          </dl>
        </div>
        <div className="surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Position actuelle</h2>
          {position.available ? (<>
            <Row label="Lieu" value={position.locationLabel ?? "—"} />
            <Row label="Source" value={position.source} />
            <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">Confiance</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONF[position.confidence]}`}>{position.confidence}</span></dd></div>
            <Row label="Fraîcheur" value={freshnessLabel(position.freshness)} />
          </>) : <p className="text-xs text-slate-500">{position.explanation}</p>}
        </div>
      </div>

      <ShipmentMapLoader projection={map} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Journal (immuable)</h2>
          {timeline.length === 0 ? <p className="text-xs text-slate-500">Aucun évènement.</p> : (
            <ol className="space-y-2">{[...timeline].reverse().map((e, i) => (
              <li key={`${e.fingerprint}-${i}`} className="flex items-start gap-3 text-sm">
                <span className="tabular mt-0.5 w-28 shrink-0 text-xs text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</span>
                <span className="flex-1"><span className="font-medium text-navy-800">{airMilestoneLabel(e.eventType as AirMilestone)}</span><span className="ml-2 text-xs text-slate-500"><span className={`rounded px-1.5 py-0.5 ${CONF[e.confidence]}`}>{e.confidence}</span><span className="ml-1">{e.source}</span>{e.location?.name ? ` · ${e.location.name}` : ""}</span></span>
              </li>
            ))}</ol>
          )}
        </div>
        <div className="space-y-4">
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">ULD ({ulds.length})</h2>
            {ulds.length === 0 ? <p className="text-xs text-slate-500">Aucun ULD.</p> : <ul className="space-y-1">{ulds.map((u) => <li key={u.id} className="flex items-center justify-between text-xs"><span className="tabular font-medium text-navy-800">{u.number}</span><span className="text-slate-500">{u.type ?? "—"} · {u.status}</span></li>)}</ul>}
          </div>
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Documents</h2>
            {docs.length === 0 ? <p className="text-xs text-slate-500">Aucun document aérien associé.</p> : <ul className="space-y-1">{docs.map((d) => <li key={d.id} className="flex items-center justify-between text-xs"><span className="text-navy-800">{d.typeLabel}</span><span className="text-slate-500">{d.status}</span></li>)}</ul>}
          </div>
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseur</h2>
            <Row label="Fournisseur" value={provider.displayName} />
            <Row label="État" value={provider.status === "configured" ? "Actif" : "Non connecté"} />
            {provider.status === "unsupported" && provider.requiredInputs.length > 0 && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"><p className="mb-1 font-semibold">Connexion compagnie bloquée — prérequis :</p><ul className="list-inside list-disc space-y-0.5">{provider.requiredInputs.slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul></div>}
          </div>
        </div>
      </div>

      {canWrite && <AirConsole shipmentId={s.id} currentMilestone={s.milestone} lastEventAt={lastEventAt} ulds={ulds.map((u) => ({ id: u.id, number: u.number }))} flights={flights} awb={{ mawb: s.mawb, hawb: s.hawb }} />}
    </div>
  );
}
