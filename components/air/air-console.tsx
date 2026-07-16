"use client";

/**
 * Air Cargo — shipment interactive panel (Phase 7.3A). Client component. Manual tracking
 * studio (effect preview via pure previewAirEvent) + AWB/ULD/cargo/ETA forms. Each invokes a
 * server action that re-validates + audits. No client tenant/actor; events stored as MANUAL.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualAirEvent, type AirActionResult } from "@/lib/air/intelligence/actions";
import { updateAwb, createUld, createCargoPiece, updateAirEta, type AirMgmtResult } from "@/lib/air/intelligence/manage-actions";
import { previewAirEvent } from "@/lib/air/intelligence/studio";
import { AIR_MILESTONES, airMilestoneLabel, type AirMilestone } from "@/lib/air/intelligence/milestones";
import type { Option } from "@/lib/air/intelligence/manage-service";

const EVENT_OPTIONS = [...AIR_MILESTONES, "POSITION_UPDATE", "ETA_UPDATE"] as const;
const ERR: Record<string, string> = {
  forbidden: "Non autorisé.", not_found: "Introuvable.", not_air: "Non aérien.", invalid_event_type: "Type invalide.",
  invalid_timestamp: "Date invalide.", invalid_coordinate: "Coordonnées invalides.", invalid_transition: "Transition non permise.",
  terminal: "État final.", confirmation_required: "Confirmation requise.", duplicate_event: "Déjà enregistré.", stale_transition: "Modifié — rechargez.",
  invalid_uld_number: "N° ULD invalide.", duplicate_uld: "ULD déjà présent.", invalid_flight: "Vol invalide.", invalid_status: "Statut invalide.",
  invalid_source: "Source invalide.", invalid_piece_count: "Nombre de pièces invalide.", invalid_uld: "ULD invalide.", generic: "Erreur.",
};
const inp = "rounded-md border border-slate-200 px-2 py-1 text-sm"; const lab = "flex flex-col gap-1 text-xs text-slate-600";

export function AirConsole({ shipmentId, currentMilestone, lastEventAt, ulds, flights, awb }: {
  shipmentId: string; currentMilestone: AirMilestone; lastEventAt: string | null;
  ulds: { id: string; number: string }[]; flights: Option[]; awb: { mawb: string | null; hawb: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [eventType, setEventType] = useState("ACCEPTED");
  const [occurredAt, setOccurredAt] = useState("");
  const [confirmCorrection, setConfirm] = useState(false);
  const preview = useMemo(() => previewAirEvent(currentMilestone, eventType, occurredAt || null, lastEventAt), [currentMilestone, eventType, occurredAt, lastEventAt]);

  function run(fn: () => Promise<AirActionResult | AirMgmtResult>, reset?: HTMLFormElement) {
    setMsg(null);
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[r.error] ?? ERR.generic }); if (r.ok) { reset?.reset(); router.refresh(); } });
  }

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Suivi et opérations (aérien)</h2>

      {/* Manual studio */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const lat = String(f.get("lat") ?? "").trim(); const lon = String(f.get("lon") ?? "").trim(); run(() => addManualAirEvent(shipmentId, { eventType, occurredAt: occurredAt || new Date().toISOString(), uldId: String(f.get("uld") ?? "") || null, locationName: String(f.get("locname") ?? "") || null, locationIata: String(f.get("iata") ?? "") || null, latitude: lat ? Number(lat) : null, longitude: lon ? Number(lon) : null, flightNumber: String(f.get("flightno") ?? "") || null, description: String(f.get("desc") ?? "") || null, confirmCorrection })); }} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 text-xs text-amber-700">Chaque évènement est étiqueté « Manuel ».</p>
        <label className={lab}>Évènement<select value={eventType} onChange={(e) => setEventType(e.target.value)} className={inp}>{EVENT_OPTIONS.map((m) => <option key={m} value={m}>{m === "POSITION_UPDATE" ? "Position" : m === "ETA_UPDATE" ? "ETA (voir ci-dessous)" : airMilestoneLabel(m as AirMilestone)}</option>)}</select></label>
        <label className={lab}>Date/heure<input type="datetime-local" onChange={(e) => setOccurredAt(e.target.value ? new Date(e.target.value).toISOString() : "")} className={inp} /></label>
        <label className={lab}>ULD<select name="uld" className={inp}><option value="">—</option>{ulds.map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}</select></label>
        <label className={lab}>Aéroport (IATA)<input name="iata" placeholder="DKR" className={inp} /></label>
        <label className={lab}>Lieu (nom)<input name="locname" className={inp} /></label>
        <label className={lab}>N° vol<input name="flightno" className={inp} /></label>
        <label className={lab}>Latitude<input name="lat" inputMode="decimal" className={inp} /></label>
        <label className={lab}>Longitude<input name="lon" inputMode="decimal" className={inp} /></label>
        <label className={`${lab} sm:col-span-2`}>Note<input name="desc" className={inp} /></label>
        <div className="sm:col-span-2 space-y-1">
          <div className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${preview.ok ? (preview.kind === "regress" ? "bg-amber-100 text-amber-800" : "bg-teal-50 text-teal-700") : "bg-red-50 text-red-700"}`}>{preview.message}</div>
          {preview.outOfOrder && <p className="text-xs text-amber-700">⚠ Horodatage hors séquence.</p>}
          {preview.requiresConfirmation && <label className="flex items-center gap-2 text-xs text-amber-800"><input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirm(e.target.checked)} />Je confirme cette correction.</label>}
        </div>
        <div className="sm:col-span-2"><button disabled={pending || !preview.ok || eventType === "ETA_UPDATE"} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Enregistrer l&apos;évènement</button></div>
      </form>

      {/* AWB */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => updateAwb(shipmentId, { mawb: String(f.get("mawb") ?? ""), hawb: String(f.get("hawb") ?? ""), flightId: String(f.get("flight") ?? "") || null, status: String(f.get("astatus") ?? "") || null })); }} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
        <p className="sm:col-span-4 text-xs font-medium text-slate-500">Lettre de transport aérien (AWB)</p>
        <label className={lab}>MAWB<input name="mawb" defaultValue={awb.mawb ?? ""} className={inp} /></label>
        <label className={lab}>HAWB<input name="hawb" defaultValue={awb.hawb ?? ""} className={inp} /></label>
        <label className={lab}>Vol<select name="flight" className={inp}><option value="">—</option>{flights.map((fl) => <option key={fl.id} value={fl.id}>{fl.label}</option>)}</select></label>
        <label className={lab}>Statut<select name="astatus" className={inp}><option value="">—</option>{["DRAFT", "ISSUED", "CONFIRMED", "CANCELLED"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <div className="sm:col-span-4"><button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">Enregistrer l&apos;AWB</button></div>
      </form>

      {/* ULD + cargo */}
      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createUld(shipmentId, { number: String(d.get("unum") ?? ""), type: String(d.get("utype") ?? "") || null, owner: String(d.get("uowner") ?? "") || null }), f); }} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
        <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ajouter un ULD</p>
        <label className={lab}>N° ULD<input name="unum" placeholder="AKE12345AF" className={inp} /></label>
        <label className={lab}>Type<input name="utype" placeholder="AKE" className={inp} /></label>
        <label className={lab}>Propriétaire<input name="uowner" className={inp} /></label>
        <div className="sm:col-span-3"><button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">Créer l&apos;ULD</button></div>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createCargoPiece(shipmentId, { pieceCount: Number(d.get("pcs") ?? 1), weightKg: d.get("wt") ? Number(d.get("wt")) : null, dimensions: String(d.get("dim") ?? "") || null, dangerousGoods: d.get("dg") === "on", temperatureControlled: d.get("temp") === "on" }), f); }} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
        <p className="sm:col-span-4 text-xs font-medium text-slate-500">Ajouter des pièces</p>
        <label className={lab}>Pièces<input name="pcs" type="number" min={1} defaultValue={1} className={inp} /></label>
        <label className={lab}>Poids (kg)<input name="wt" inputMode="decimal" className={inp} /></label>
        <label className={lab}>Dimensions<input name="dim" className={inp} /></label>
        <div className="flex items-end gap-3 text-xs text-slate-600"><label className="flex items-center gap-1"><input type="checkbox" name="dg" /> DGR</label><label className="flex items-center gap-1"><input type="checkbox" name="temp" /> Temp.</label></div>
        <div className="sm:col-span-4"><button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">Ajouter les pièces</button></div>
      </form>

      {/* ETA */}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const v = String(f.get("etaval") ?? ""); if (!v) { setMsg({ ok: false, text: "Date invalide." }); return; } run(() => updateAirEta(shipmentId, v, String(f.get("etasrc") ?? "MANUAL"))); }} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className={lab}>Nouvelle ETA<input type="datetime-local" name="etaval" className={inp} /></label>
        <label className={lab}>Source<select name="etasrc" className={inp}><option value="MANUAL">Manuelle</option><option value="CARRIER">Compagnie</option><option value="SYSTEM_ESTIMATE">Estimation</option></select></label>
        <button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-navy-700 disabled:opacity-50">Mettre à jour l&apos;ETA</button>
      </form>

      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
