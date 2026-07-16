"use client";

/**
 * Shipment operations panel (Phase 7.2B). Client component. Compact forms for booking/BL,
 * container creation, and route-leg planning — each invokes a server action that re-checks
 * permission, validates, and audits. No client-supplied tenant/actor.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBookingBl, createContainer, upsertRouteLeg, type MgmtResult } from "@/lib/shipping/intelligence/manage-actions";
import type { Option } from "@/lib/shipping/intelligence/manage-service";

const ERR: Record<string, string> = {
  forbidden: "Non autorisé.", not_found: "Introuvable.", invalid_carrier: "Transporteur invalide.", invalid_port: "Port invalide.",
  invalid_vessel: "Navire invalide.", invalid_voyage: "Voyage invalide.", invalid_container_number: "N° conteneur ISO 6346 invalide.",
  duplicate_container: "Conteneur déjà présent.", invalid_booking_status: "Statut invalide.", invalid_sequence: "Séquence invalide.",
  planned_arrival_before_departure: "Arrivée avant départ.", confirmation_required: "Confirmation requise.", conflict_on_target: "Conflit sur la cible.",
  same_shipment: "Même expédition.", invalid_shipment: "Expédition invalide.", generic: "Erreur.",
};

export function ShipmentOpsPanel({ shipmentId, options, booking }: {
  shipmentId: string;
  options: { carriers: Option[]; ports: Option[]; vessels: Option[]; voyages: Option[] };
  booking: { bookingReference: string | null; bookingStatus: string | null; masterBl: string | null; houseBl: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<MgmtResult>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[res.error] ?? ERR.generic });
      if (res.ok) router.refresh();
    });
  }

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Opérations de l&apos;expédition</h2>

      {/* Booking / BL */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => updateBookingBl(shipmentId, { bookingReference: String(f.get("bref") ?? ""), bookingStatus: String(f.get("bstatus") ?? "") || null, masterBl: String(f.get("mbl") ?? ""), houseBl: String(f.get("hbl") ?? ""), carrierId: String(f.get("carrier") ?? "") || null })); }} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 text-xs font-medium text-slate-500">Réservation &amp; connaissement</p>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Réservation<input name="bref" defaultValue={booking.bookingReference ?? ""} className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Statut réservation
          <select name="bstatus" defaultValue={booking.bookingStatus ?? ""} className="rounded-md border border-slate-200 px-2 py-1 text-sm">
            <option value="">—</option>{["DRAFT", "REQUESTED", "CONFIRMED", "AMENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Master BL<input name="mbl" defaultValue={booking.masterBl ?? ""} className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">House BL<input name="hbl" defaultValue={booking.houseBl ?? ""} className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Transporteur
          <select name="carrier" className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="">—</option>{options.carriers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
        <div className="sm:col-span-2"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">Enregistrer réservation/BL</button></div>
      </form>

      {/* Container */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => createContainer(shipmentId, { number: String(f.get("cnum") ?? ""), isoType: String(f.get("ctype") ?? "") || null, sealNumber: String(f.get("cseal") ?? "") || null })); (e.currentTarget as HTMLFormElement).reset(); }} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
        <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ajouter un conteneur (ISO 6346)</p>
        <label className="flex flex-col gap-1 text-xs text-slate-600">N° conteneur<input name="cnum" placeholder="CSQU3054383" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Type ISO<input name="ctype" placeholder="22G1" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Plomb<input name="cseal" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <div className="sm:col-span-3"><button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">Créer le conteneur</button></div>
      </form>

      {/* Route leg */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => upsertRouteLeg(shipmentId, { sequence: Number(f.get("seq") ?? 1), originPortId: String(f.get("oport") ?? "") || null, destinationPortId: String(f.get("dport") ?? "") || null, mode: String(f.get("mode") ?? "SEA"), vesselId: String(f.get("vessel") ?? "") || null, voyageId: String(f.get("voyage") ?? "") || null, plannedDeparture: String(f.get("pdep") ?? "") || null, plannedArrival: String(f.get("parr") ?? "") || null })); }} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
        <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ajouter/mettre à jour une étape de route (planifiée)</p>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Séquence<input name="seq" type="number" min={1} defaultValue={1} className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Mode
          <select name="mode" className="rounded-md border border-slate-200 px-2 py-1 text-sm">{["SEA", "TRANSSHIPMENT", "ROAD", "RAIL"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Navire
          <select name="vessel" className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="">—</option>{options.vessels.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Port origine
          <select name="oport" className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="">—</option>{options.ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Port destination
          <select name="dport" className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="">—</option>{options.ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Voyage
          <select name="voyage" className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="">—</option>{options.voyages.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Départ prévu<input name="pdep" type="date" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Arrivée prévue<input name="parr" type="date" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <div className="sm:col-span-3"><button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">Enregistrer l&apos;étape</button></div>
      </form>

      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
