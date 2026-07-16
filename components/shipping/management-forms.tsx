"use client";

/**
 * Ocean reference-data create forms (Phase 7.2B). Client components. Each invokes a server
 * action that re-checks transport:manage, validates, and audits. No client tenant/actor. No
 * invented data — coordinates/identifiers are operator-entered and server-validated.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCarrier, createPort, createVessel, createVoyage, updateCarrier, updatePort, updateVessel, reassignContainer, type MgmtResult } from "@/lib/shipping/intelligence/manage-actions";
import type { Option } from "@/lib/shipping/intelligence/manage-service";

const ERR: Record<string, string> = {
  forbidden: "Non autorisé.", name_required: "Nom requis.", invalid_url: "URL invalide (http/https).", duplicate_code: "Code déjà utilisé.",
  invalid_unlocode: "UN/LOCODE invalide.", invalid_coordinate: "Coordonnées invalides.", duplicate_unlocode: "UN/LOCODE déjà utilisé.",
  invalid_imo: "Numéro IMO invalide.", invalid_mmsi: "MMSI invalide.", invalid_carrier: "Transporteur invalide.", invalid_vessel: "Navire invalide.",
  invalid_port: "Port invalide.", planned_arrival_before_departure: "Arrivée avant départ.", generic: "Erreur.",
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<MgmtResult>, form?: HTMLFormElement) => {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: "Créé." } : { ok: false, text: ERR[res.error] ?? ERR.generic });
      if (res.ok) { form?.reset(); router.refresh(); }
    });
  };
  return { pending, msg, run };
}
const input = "rounded-md border border-slate-200 px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";

/** Retire / reactivate a reference record (no destructive delete). */
export function RetireControl({ entity, id, active }: { entity: "carrier" | "port" | "vessel"; id: string; active: boolean }) {
  const { pending, run } = useRun();
  const toggle = () => {
    const next = !active;
    if (entity === "carrier") run(() => updateCarrier(id, { active: next }));
    else if (entity === "port") run(() => updatePort(id, { active: next }));
    else run(() => updateVessel(id, { active: next }));
  };
  return (
    <button onClick={toggle} disabled={pending} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {active ? "Retirer" : "Réactiver"}
    </button>
  );
}

/** Reassign a container to another shipment — requires an explicit confirmation checkbox. */
export function ContainerReassign({ containerId }: { containerId: string }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">Réaffecter</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const target = String(d.get("target") ?? ""); const confirm = d.get("confirm") === "on"; run(() => reassignContainer(containerId, target, confirm)); }} className="flex items-center gap-1">
      <input name="target" placeholder="ID expédition cible" className="w-40 rounded-md border border-slate-200 px-2 py-0.5 text-xs" />
      <label className="flex items-center gap-1 text-xs text-amber-800"><input type="checkbox" name="confirm" /> confirmer</label>
      <button disabled={pending} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-navy-700 disabled:opacity-50">OK</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}
    </form>
  );
}

export function CarrierForm() {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createCarrier({ code: String(d.get("code") ?? ""), name: String(d.get("name") ?? ""), scac: String(d.get("scac") ?? "") || null, website: String(d.get("website") ?? "") || null, notes: String(d.get("notes") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouveau transporteur</p>
      <label className={label}>Code<input name="code" required className={input} /></label>
      <label className={label}>Nom<input name="name" required className={input} /></label>
      <label className={label}>SCAC (si connu)<input name="scac" className={input} /></label>
      <label className={label}>Site officiel<input name="website" placeholder="https://…" className={input} /></label>
      <label className={`${label} sm:col-span-2`}>Notes internes<input name="notes" className={input} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}</div>
    </form>
  );
}

export function PortForm() {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); const lat = String(d.get("lat") ?? "").trim(); const lon = String(d.get("lon") ?? "").trim(); run(() => createPort({ unlocode: String(d.get("unlocode") ?? "") || null, name: String(d.get("name") ?? ""), country: String(d.get("country") ?? "") || null, latitude: lat ? Number(lat) : null, longitude: lon ? Number(lon) : null, timezone: String(d.get("tz") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouveau port</p>
      <label className={label}>UN/LOCODE<input name="unlocode" placeholder="SNDKR" className={input} /></label>
      <label className={label}>Nom<input name="name" required className={input} /></label>
      <label className={label}>Pays<input name="country" className={input} /></label>
      <label className={label}>Latitude (optionnel)<input name="lat" inputMode="decimal" className={input} /></label>
      <label className={label}>Longitude (optionnel)<input name="lon" inputMode="decimal" className={input} /></label>
      <label className={label}>Fuseau<input name="tz" className={input} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}<span className="ml-2 text-xs text-slate-400">Sans coordonnées → non cartographiable.</span></div>
    </form>
  );
}

export function VesselForm({ carriers }: { carriers: Option[] }) {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createVessel({ name: String(d.get("name") ?? ""), imo: String(d.get("imo") ?? "") || null, mmsi: String(d.get("mmsi") ?? "") || null, flag: String(d.get("flag") ?? "") || null, carrierId: String(d.get("carrier") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouveau navire</p>
      <label className={label}>Nom<input name="name" required className={input} /></label>
      <label className={label}>IMO<input name="imo" placeholder="9074729" className={input} /></label>
      <label className={label}>MMSI<input name="mmsi" placeholder="227006760" className={input} /></label>
      <label className={label}>Pavillon<input name="flag" className={input} /></label>
      <label className={label}>Transporteur<select name="carrier" className={input}><option value="">—</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}</div>
    </form>
  );
}

export function VoyageForm({ vessels, ports }: { vessels: Option[]; ports: Option[] }) {
  const { pending, msg, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); run(() => createVoyage({ carrierVoyageRef: String(d.get("ref") ?? "") || null, vesselId: String(d.get("vessel") ?? "") || null, originPortId: String(d.get("oport") ?? "") || null, destinationPortId: String(d.get("dport") ?? "") || null, plannedDeparture: String(d.get("pdep") ?? "") || null, plannedArrival: String(d.get("parr") ?? "") || null }), f); }} className="surface grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
      <p className="sm:col-span-3 text-sm font-semibold text-navy-900">Nouveau voyage</p>
      <label className={label}>Référence voyage<input name="ref" className={input} /></label>
      <label className={label}>Navire<select name="vessel" className={input}><option value="">—</option>{vessels.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <label className={label}>Port origine<select name="oport" className={input}><option value="">—</option>{ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className={label}>Port destination<select name="dport" className={input}><option value="">—</option>{ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className={label}>Départ prévu<input name="pdep" type="date" className={input} /></label>
      <label className={label}>Arrivée prévue<input name="parr" type="date" className={input} /></label>
      <div className="sm:col-span-3"><button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Créer</button>{msg && <span className={`ml-2 text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</span>}</div>
    </form>
  );
}
