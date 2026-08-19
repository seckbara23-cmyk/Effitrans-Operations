"use client";

/**
 * TMS-5 — Parc & Flotte console. Client component.
 * ---------------------------------------------------------------------------
 * Register a vehicle, record compliance dates, open and close an intervention.
 * Every control is rendered only for `transport:manage` holders; the server
 * asserts the same authority again. « En mission » is never a control here —
 * it is derived from transport execution and shown read-only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createVehicle,
  openVehicleMaintenance,
  closeVehicleMaintenance,
  setVehicleStatus,
  upsertVehicleCompliance,
  deleteVehicle,
  type FleetResult,
} from "@/lib/fleet/actions";
import type { FleetVehicle } from "@/lib/fleet/service";

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée.",
  registration_required: "L'immatriculation est obligatoire.",
  duplicate_registration: "Cette immatriculation existe déjà dans le parc.",
  invalid_type: "Type invalide.",
  invalid_status: "Disponibilité invalide.",
  invalid_kind: "Nature d'intervention invalide.",
  description_required: "Une description est obligatoire.",
  maintenance_open: "Une intervention immobilisante est déjà ouverte pour ce véhicule.",
  already_closed: "Cette intervention est déjà clôturée.",
  not_found: "Véhicule introuvable.",
  confirmation_mismatch: "L'immatriculation saisie ne correspond pas.",
  vehicle_in_use: "Suppression refusée : ce véhicule est affecté à un transport ou a déjà servi. Mettez-le hors service.",
  vehicle_has_history: "Suppression refusée : des interventions sont enregistrées pour ce véhicule. Mettez-le hors service.",
  generic: "L'action a échoué. Réessayez.",
};

const TYPES: [string, string][] = [
  ["CAMION", "Camion"], ["CAMIONNETTE", "Camionnette"], ["VOITURE", "Voiture"],
  ["TRACTEUR", "Tracteur"], ["REMORQUE", "Remorque"], ["AUTRE", "Autre"],
];
const COMPLIANCE: [string, string][] = [
  ["ASSURANCE", "Assurance"], ["VISITE_TECHNIQUE", "Visite technique"],
  ["CARTE_GRISE", "Carte grise"], ["LICENCE_TRANSPORT", "Licence de transport"],
  ["VIGNETTE", "Vignette"], ["AUTRE", "Autre"],
];

const inp = "rounded-md border border-slate-200 px-2 py-1 text-sm";
const lab = "flex flex-col gap-1 text-xs text-slate-600";

export function FleetConsole({ vehicles }: { vehicles: FleetVehicle[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<string>(vehicles[0]?.id ?? "");
  const [confirmDelete, setConfirmDelete] = useState("");
  /**
   * TMS-5C — THE PRODUCTION DEFECT this fixes. `useState(vehicles[0]?.id)` runs
   * its initializer ONCE. An operator who opened an EMPTY parc got target="",
   * and after adding the first vehicle React kept that stale "" — while the
   * <select> visually showed the new vehicle. Every `!target` control stayed
   * greyed out with no explanation, so compliance and intervention submissions
   * never even reached the server (production confirms: zero child rows).
   * Deriving it from the current list self-heals after any create or delete.
   */
  const target = vehicles.some((v) => v.id === picked) ? picked : (vehicles[0]?.id ?? "");

  function run(fn: () => Promise<FleetResult>, form?: HTMLFormElement) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[r.error] ?? ERR.generic });
      if (r.ok) { form?.reset(); router.refresh(); }
    });
  }

  const selected = vehicles.find((v) => v.id === target) ?? null;

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Gestion du parc</h2>

      {/* Register */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const d = new FormData(f);
          const numOrNull = (k: string) => {
            const v = String(d.get(k) ?? "").trim();
            return v ? Number(v) : null;
          };
          run(() => createVehicle({
            registration: String(d.get("registration") ?? ""),
            internalCode: String(d.get("internalCode") ?? "") || null,
            vehicleType: String(d.get("vehicleType") ?? "CAMION"),
            make: String(d.get("make") ?? "") || null,
            model: String(d.get("model") ?? "") || null,
            year: numOrNull("year"),
            capacityKg: numOrNull("capacityKg"),
            capacityM3: numOrNull("capacityM3"),
            odometerKm: numOrNull("odometerKm"),
          }), f);
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ajouter un véhicule</p>
        <label className={lab}>Immatriculation<input name="registration" required className={inp} /></label>
        <label className={lab}>Code interne<input name="internalCode" className={inp} /></label>
        <label className={lab}>Type
          <select name="vehicleType" className={inp}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={lab}>Marque<input name="make" className={inp} /></label>
        <label className={lab}>Modèle<input name="model" className={inp} /></label>
        <label className={lab}>Année<input name="year" inputMode="numeric" className={inp} /></label>
        <label className={lab}>Charge utile (kg)<input name="capacityKg" inputMode="decimal" className={inp} /></label>
        <label className={lab}>Volume (m³)<input name="capacityM3" inputMode="decimal" className={inp} /></label>
        <label className={lab}>Kilométrage<input name="odometerKm" inputMode="decimal" className={inp} /></label>
        <div className="sm:col-span-3">
          <button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Ajouter au parc
          </button>
        </div>
      </form>

      {vehicles.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <label className={lab}>Véhicule concerné
            <select value={target} onChange={(e) => setPicked(e.target.value)} className={inp}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration}{v.internalCode ? ` — ${v.internalCode}` : ""}
                </option>
              ))}
            </select>
          </label>

          {selected?.engaged && (
            <p className="text-xs text-amber-700">
              Ce véhicule est actuellement en mission ({selected.engagedFileNumbers.join(", ") || "dossier en cours"}).
            </p>
          )}

          {/* Compliance */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const d = new FormData(f);
              run(() => upsertVehicleCompliance({
                vehicleId: target,
                typeCode: String(d.get("typeCode") ?? "ASSURANCE"),
                reference: String(d.get("reference") ?? "") || null,
                issuedOn: String(d.get("issuedOn") ?? "") || null,
                expiresOn: String(d.get("expiresOn") ?? "") || null,
              }), f);
            }}
            className="grid grid-cols-1 gap-2 sm:grid-cols-4"
          >
            <p className="sm:col-span-4 text-xs font-medium text-slate-500">Conformité — dates et références (aucun fichier n&apos;est stocké ici)</p>
            <label className={lab}>Pièce
              <select name="typeCode" className={inp}>
                {COMPLIANCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lab}>Référence<input name="reference" className={inp} /></label>
            <label className={lab}>Délivrée le<input type="date" name="issuedOn" className={inp} /></label>
            <label className={lab}>Expire le<input type="date" name="expiresOn" className={inp} /></label>
            <div className="sm:col-span-4">
              <button disabled={pending || !target} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">
                Enregistrer la conformité
              </button>
            </div>
          </form>

          {/* Maintenance */}
          {selected?.openMaintenance ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                const d = new FormData(f);
                run(() => closeVehicleMaintenance(selected.openMaintenance!.id, String(d.get("resolution") ?? "")), f);
              }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <p className="sm:col-span-3 text-xs font-medium text-slate-500">
                Intervention ouverte depuis le {selected.openMaintenance.openedOn} — {selected.openMaintenance.description}
              </p>
              <label className={`${lab} sm:col-span-2`}>Résolution<input name="resolution" className={inp} /></label>
              <div className="sm:col-span-3">
                <button disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">
                  Clôturer et remettre en service
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                const d = new FormData(f);
                run(() => openVehicleMaintenance({
                  vehicleId: target,
                  kind: String(d.get("kind") ?? "PLANNED"),
                  description: String(d.get("description") ?? ""),
                  immobilizing: String(d.get("immobilizing") ?? "") === "on",
                }), f);
              }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ouvrir une intervention</p>
              <label className={lab}>Nature
                <select name="kind" className={inp}>
                  <option value="PLANNED">Planifiée</option>
                  <option value="UNPLANNED">Imprévue</option>
                </select>
              </label>
              <label className={`${lab} sm:col-span-2`}>Description<input name="description" required className={inp} /></label>
              <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-3">
                <input type="checkbox" name="immobilizing" defaultChecked />
                Immobilise le véhicule (il ne pourra plus être affecté à un transport)
              </label>
              <div className="sm:col-span-3">
                <button disabled={pending || !target} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50">
                  Ouvrir l&apos;intervention
                </button>
              </div>
            </form>
          )}

          {/* Availability */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">Disponibilité :</span>
            {(["AVAILABLE", "OUT_OF_SERVICE"] as const).map((s) => {
              // A control that is off because the vehicle is ALREADY in that
              // state says so, rather than being an unexplained grey button.
              const already = selected?.status === s;
              return (
                <button
                  key={s}
                  disabled={pending || !target || already}
                  title={already ? "Le véhicule est déjà dans cet état." : undefined}
                  onClick={() => run(() => setVehicleStatus(target, s))}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-navy-700 disabled:opacity-40"
                >
                  {s === "AVAILABLE" ? "Déclarer disponible" : "Mettre hors service"}
                </button>
              );
            })}
            {selected && (
              <span className="text-xs text-slate-400">
                État actuel : {selected.status === "AVAILABLE" ? "Disponible" : selected.status === "MAINTENANCE" ? "Maintenance" : "Hors service"}
                {selected.openMaintenance ? " — une intervention est ouverte" : ""}
              </span>
            )}
          </div>

          {/* TMS-5C — permanent removal of a vehicle that never served. The
              server decides eligibility; this only asks for an unambiguous
              confirmation naming the immatriculation being destroyed. */}
          {selected && (
            <div className="space-y-2 border-t border-red-100 pt-3">
              <p className="text-xs font-medium text-red-700">Suppression définitive</p>
              <p className="text-xs text-slate-500">
                Un véhicule qui a servi à un transport ou qui porte des interventions ne peut pas être
                supprimé : utilisez « Mettre hors service ». Pour confirmer la suppression définitive de
                <strong> {selected.registration}</strong>, saisissez son immatriculation.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value)}
                  placeholder={selected.registration}
                  className={inp}
                  disabled={pending}
                />
                <button
                  disabled={pending || confirmDelete.trim().toUpperCase() !== selected.registration.toUpperCase()}
                  onClick={() => {
                    run(() => deleteVehicle(target, confirmDelete.trim()));
                    setConfirmDelete("");
                  }}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  Supprimer définitivement
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
