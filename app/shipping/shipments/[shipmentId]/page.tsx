import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getOceanShipmentDetail } from "@/lib/shipping/intelligence/service";
import { listRouteLegs, listCarrierOptions, listPortOptions, listVesselOptions, listVoyageOptions } from "@/lib/shipping/intelligence/manage-service";
import { listDocuments } from "@/lib/documents/service";
import { milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";
import { freshnessLabel, ageLabelFr } from "@/lib/shipping/intelligence/freshness";
import { sourceLabelFr, confidenceLabelFr, eventIsMilestone } from "@/lib/shipping/intelligence/events";
import { TrackingJourney, type JourneyEvent } from "@/components/shipping/tracking-journey";
import { TrackingStudio } from "@/components/shipping/tracking-studio";
import { ShipmentOpsPanel } from "@/components/shipping/shipment-ops-panel";

export const metadata: Metadata = { title: "Expédition maritime" };
export const dynamic = "force-dynamic";

const SHIPPING_DOC_TYPES = ["BILL_OF_LADING", "AIRWAY_BILL", "BON_A_DELIVRER", "COMMERCIAL_INVOICE", "PACKING_LIST", "CERTIFICATE_OF_ORIGIN", "CUSTOMS_DECLARATION"];
const CONF_STYLE: Record<string, string> = { CONFIRMED: "bg-teal-50 text-teal-700", INFERRED: "bg-amber-50 text-amber-700", MANUAL: "bg-sky-50 text-sky-700", ESTIMATED: "bg-slate-100 text-slate-500" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">{label}</dt><dd className="tabular text-right font-medium text-navy-800">{value}</dd></div>;
}

export default async function ShipmentDetailPage({ params }: { params: { shipmentId: string } }) {
  const header = <PageHeader meta="Maritime" title="Expédition" subtitle="Jalon canonique, carte, journal, route et fournisseur." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) notFound();

  const detail = await getOceanShipmentDetail(params.shipmentId);
  if (!detail) notFound();

  const canWrite = hasPermission(permissions, "transport:update");
  const canManage = hasPermission(permissions, "transport:manage");
  const [routeLegs, carriers, ports, vessels, voyages, documents] = await Promise.all([
    listRouteLegs(params.shipmentId),
    canWrite ? listCarrierOptions() : Promise.resolve([]),
    canWrite ? listPortOptions() : Promise.resolve([]),
    canWrite ? listVesselOptions() : Promise.resolve([]),
    canWrite ? listVoyageOptions() : Promise.resolve([]),
    hasPermission(permissions, "document:read") ? listDocuments(detail.shipment.fileId).catch(() => []) : Promise.resolve([]),
  ]);

  const { shipment: s, containers, timeline, position, map, customs, provider, nextMilestones } = detail;
  const lastEventAt = timeline.length ? timeline[timeline.length - 1].occurredAt : null;
  const shippingDocs = documents.filter((d) => SHIPPING_DOC_TYPES.includes(d.typeCode));

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/shipping/shipments" className="text-teal-700 hover:underline">← Expéditions</Link>
        {s.fileNumber && <><span className="text-slate-300">·</span><Link href={`/files/${s.fileId}`} className="text-navy-700 hover:text-teal-700">Dossier {s.fileNumber}</Link></>}
        {customs.present && <><span className="text-slate-300">·</span><Link href="/customs/intelligence" className="text-navy-700 hover:text-teal-700">Douane</Link></>}
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
        <div className="surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Position actuelle</h2>
          {position.available ? (
            <>
              <Row label="Lieu" value={position.locationLabel ?? "—"} />
              {/* 8.4 — French source label + AGE, never a raw enum, never liveness language. */}
              <Row label="Source" value={`${sourceLabelFr(position.source)}${position.occurredAt ? ` · ${ageLabelFr(position.occurredAt, new Date().toISOString())}` : ""}`} />
              <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">Confiance</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONF_STYLE[position.confidence]}`}>{confidenceLabelFr(position.confidence)}</span></dd></div>
              <Row label="Fraîcheur" value={freshnessLabel(position.freshness)} />
            </>
          ) : <p className="text-xs text-slate-500">{position.explanation}</p>}
        </div>
      </div>

      {/* 8.4 — map + immutable journal share ONE selection state (one canonical reader). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrackingJourney
            projection={map}
            currentFreshnessLabel={position.available ? freshnessLabel(position.freshness) : null}
            events={timeline.map((e): JourneyEvent => ({
              fingerprint: e.fingerprint,
              label: milestoneLabel(e.eventType as ShippingMilestone),
              occurredAt: e.occurredAt,
              source: e.source,
              confidence: e.confidence,
              locationName: e.location?.name ?? null,
              // A row is map-linked when it is a milestone WITH coordinates (matches the
              // projection's milestone markers exactly).
              hasCoordinates: eventIsMilestone(e.eventType) && e.location?.latitude != null && e.location?.longitude != null,
            }))}
          />
        </div>

        <div className="space-y-4">
          {/* Route */}
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Route (planifiée)</h2>
            {routeLegs.length === 0 ? <p className="text-xs text-slate-500">Aucune étape planifiée.</p> : (
              <ol className="space-y-1">
                {routeLegs.map((l) => (
                  <li key={l.sequence} className="flex items-center justify-between text-xs">
                    <span className="text-navy-800">{l.sequence}. {l.originPort ?? "?"} → {l.destinationPort ?? "?"}</span>
                    <span className="text-slate-500">{l.mode}{l.actualDeparture ? " · réel" : " · prévu"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {/* Containers */}
          <div className="surface p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-navy-900">Conteneurs ({containers.length})</h2>
              <Link href="/shipping/containers" className="text-xs text-teal-700 hover:underline">Tous les conteneurs →</Link>
            </div>
            {containers.length === 0 ? <p className="text-xs text-slate-500">Aucun conteneur.</p> : (
              <ul className="space-y-1">{containers.map((c) => <li key={c.id} className="flex items-center justify-between text-xs"><span className="tabular font-medium text-navy-800">{c.number}</span><span className="text-slate-500">{c.isoType ?? "—"} · {c.status}</span></li>)}</ul>
            )}
          </div>
          {/* Documents (reuse existing document system) */}
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Documents</h2>
            {shippingDocs.length === 0 ? <p className="text-xs text-slate-500">Aucun document maritime associé.</p> : (
              <ul className="space-y-1">{shippingDocs.map((d) => <li key={d.id} className="flex items-center justify-between text-xs"><span className="text-navy-800">{d.typeLabel}</span><span className="text-slate-500">{d.status}</span></li>)}</ul>
            )}
          </div>
        </div>
      </div>

      {canWrite && (
        <>
          <TrackingStudio shipmentId={s.id} currentMilestone={s.milestone} lastEventAt={lastEventAt} containers={containers.map((c) => ({ id: c.id, number: c.number }))} />
          <ShipmentOpsPanel shipmentId={s.id} options={{ carriers, ports, vessels, voyages }} booking={{ bookingReference: s.bookingReference, bookingStatus: s.bookingStatus, masterBl: s.masterBl, houseBl: s.houseBl }} />
        </>
      )}
      {!canWrite && nextMilestones.length > 0 && <p className="text-xs text-slate-400">Vous n&apos;avez pas la permission de modifier le suivi.</p>}
      {canManage && <p className="text-xs text-slate-400"><Link href="/shipping/carriers" className="text-teal-700 hover:underline">Gérer transporteurs / ports / navires / voyages</Link></p>}
    </div>
  );
}
