"use client";

/**
 * Air Cargo — reference-data create forms (Phase 7.3A). Client components. Each invokes a
 * server action (transport:manage) that validates + audits. No client tenant/actor; no
 * invented airports/airlines/coordinates.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAirline, createAirport, createFlight, updateAirline, updateAirport, type AirMgmtResult } from "@/lib/air/intelligence/manage-actions";
import type { Option } from "@/lib/air/intelligence/manage-service";

const ERR: Record<string, string> = {
  forbidden: "Non autorisé.", name_required: "Nom requis.", invalid_iata: "Code IATA invalide.", invalid_icao: "Code ICAO invalide.",
  invalid_url: "URL invalide.", invalid_coordinate: "Coordonnées invalides.", duplicate_iata: "IATA déjà utilisé.", invalid_airline: "Compagnie invalide.",
  invalid_airport: "Aéroport invalide.", planned_arrival_before_departure: "Arrivée avant départ.", generic: "Erreur.",
};
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<AirMgmtResult>, form?: HTMLFormElement) => { setMsg(null); start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: "Créé." } : { ok: false, text: ERR[r.error] ?? ERR.generic }); if (r.ok) { form?.reset(); router.refresh(); } }); };
  return { pending, msg, run };
}
const inp = "rounded-md border border-slate-200 px-2 py-1 text-sm"; const lab = "flex flex-col gap-1 text-xs text-slate-600";

export function RetireControl({ entity, id, active }: { entity: "airline" | "airport"; id: string; active: boolean }) {
  const { pending, run } = useRun();
  return <button onClick={() => run(() => entity === "airline" ? updateAirline(id, { active: !active }) : updateAirport(id, { active: !active }))} disabled={pending} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">{active ? "Retirer" : "Réactiver"}</button>;
}

export function AirlineForm() {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createAirline({ name: String(d.get("name") ?? ""), iata: String(d.get("iata") ?? "") || null, icao: String(d.get("icao") ?? "") || null, website: String(d.get("web") ?? "") || null, notes: String(d.get("notes") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouvelle compagnie aérienne</p>
      <label className={lab}>Nom<input name="name" required className={inp} /></label>
      <label className={lab}>IATA (2)<input name="iata" placeholder="AF" className={inp} /></label>
      <label className={lab}>ICAO (3)<input name="icao" placeholder="AFR" className={inp} /></label>
      <label className={lab}>Site officiel<input name="web" placeholder="https://…" className={inp} /></label>
      <label className={`${lab} sm:col-span-2`}>Notes<input name="notes" className={inp} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}</div>
    </form>
  );
}

export function AirportForm() {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); const lat = String(d.get("lat") ?? "").trim(); const lon = String(d.get("lon") ?? "").trim(); run(() => createAirport({ iata: String(d.get("iata") ?? "") || null, icao: String(d.get("icao") ?? "") || null, name: String(d.get("name") ?? ""), city: String(d.get("city") ?? "") || null, country: String(d.get("country") ?? "") || null, latitude: lat ? Number(lat) : null, longitude: lon ? Number(lon) : null, timezone: String(d.get("tz") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouvel aéroport</p>
      <label className={lab}>IATA (3)<input name="iata" placeholder="DKR" className={inp} /></label>
      <label className={lab}>ICAO (4)<input name="icao" placeholder="GOBD" className={inp} /></label>
      <label className={lab}>Nom<input name="name" required className={inp} /></label>
      <label className={lab}>Ville<input name="city" className={inp} /></label>
      <label className={lab}>Pays<input name="country" className={inp} /></label>
      <label className={lab}>Fuseau<input name="tz" className={inp} /></label>
      <label className={lab}>Latitude (opt.)<input name="lat" inputMode="decimal" className={inp} /></label>
      <label className={lab}>Longitude (opt.)<input name="lon" inputMode="decimal" className={inp} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}<span className="ml-2 text-xs text-slate-400">Sans coordonnées → non cartographiable.</span></div>
    </form>
  );
}

export function FlightForm({ airlines, airports }: { airlines: Option[]; airports: Option[] }) {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createFlight({ flightNumber: String(d.get("fn") ?? "") || null, airlineId: String(d.get("airline") ?? "") || null, originAirportId: String(d.get("oap") ?? "") || null, destinationAirportId: String(d.get("dap") ?? "") || null, scheduledDeparture: String(d.get("std") ?? "") || null, scheduledArrival: String(d.get("sta") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouveau vol</p>
      <label className={lab}>N° vol<input name="fn" placeholder="AF718" className={inp} /></label>
      <label className={lab}>Compagnie<select name="airline" className={inp}><option value="">—</option>{airlines.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <label className={lab}>Statut<input value="SCHEDULED" disabled className={inp} /></label>
      <label className={lab}>Aéroport origine<select name="oap" className={inp}><option value="">—</option>{airports.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <label className={lab}>Aéroport destination<select name="dap" className={inp}><option value="">—</option>{airports.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <label className={lab}></label>
      <label className={lab}>Départ prévu<input name="std" type="datetime-local" className={inp} /></label>
      <label className={lab}>Arrivée prévue<input name="sta" type="datetime-local" className={inp} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}</div>
    </form>
  );
}
