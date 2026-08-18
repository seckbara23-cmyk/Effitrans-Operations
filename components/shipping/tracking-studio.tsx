"use client";

/**
 * Manual Tracking Studio (Phase 7.2B). Client component. Shows the EFFECT of a manual event
 * BEFORE submission (via the pure previewManualEvent), warns on out-of-order timestamps, and
 * requires explicit confirmation for a correction/regression. The server re-validates and
 * applies compare-and-set — the preview is a courtesy, not the authority. Every event is
 * stored as source=MANUAL / confidence=MANUAL.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualTrackingEvent, refreshShipmentTracking, type ShippingActionResult } from "@/lib/shipping/intelligence/actions";
import { updateShipmentEta, type MgmtResult } from "@/lib/shipping/intelligence/manage-actions";
import { previewManualEvent } from "@/lib/shipping/intelligence/studio";
import { SHIPPING_MILESTONES, milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";

const EVENT_OPTIONS = [...SHIPPING_MILESTONES, "POSITION_UPDATE", "ETA_UPDATE"] as const;
const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée.", not_found: "Introuvable.", not_ocean: "Non maritime.",
  invalid_event_type: "Type invalide.", invalid_timestamp: "Date invalide.", invalid_coordinate: "Coordonnées invalides.",
  invalid_unlocode: "UN/LOCODE invalide.", invalid_transition: "Transition non permise.", terminal: "État final.",
  complete_requires_delivery: "Clôture requiert livraison.", stale_transition: "Modifié entre-temps — rechargez.",
  duplicate_event: "Évènement déjà enregistré.", confirmation_required: "Confirmation de correction requise.",
  invalid_source: "Source invalide.", generic: "Erreur.",
};

export type StudioLocationOption = {
  id: string; label: string; name: string; unlocode: string | null;
  latitude: number | null; longitude: number | null;
};

export function TrackingStudio({ shipmentId, currentMilestone, lastEventAt, containers, locations = [] }: {
  shipmentId: string; currentMilestone: ShippingMilestone; lastEventAt: string | null;
  containers: { id: string; number: string }[];
  /**
   * TMS-3 — the tenant's curated port referential (optional). Choosing an
   * entry PREFILLS the location fields below from the referential row —
   * copied, never invented (a port without recorded coordinates fills none).
   * The event stays source=MANUAL: a known port position is where the event
   * happened, not vessel telemetry.
   */
  locations?: StudioLocationOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string>("IN_TRANSIT");
  const [occurredAt, setOccurredAt] = useState<string>("");
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  // TMS-3 — location fields are controlled so the referential picker can
  // prefill them; every value remains editable and optional.
  const [locationName, setLocationName] = useState("");
  const [locationUnlocode, setLocationUnlocode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  function pickLocation(id: string) {
    const p = locations.find((l) => l.id === id);
    if (!p) return;
    setLocationName(p.name);
    setLocationUnlocode(p.unlocode ?? "");
    setLatitude(p.latitude != null ? String(p.latitude) : "");
    setLongitude(p.longitude != null ? String(p.longitude) : "");
  }

  const preview = useMemo(
    () => previewManualEvent(currentMilestone, eventType, occurredAt || null, lastEventAt),
    [currentMilestone, eventType, occurredAt, lastEventAt],
  );

  function run(fn: () => Promise<ShippingActionResult | MgmtResult>) {
    setError(null); setOk(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(ERRORS[res.error] ?? ERRORS.generic); return; }
      setOk("Enregistré."); router.refresh();
    });
  }

  function submitEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const lat = latitude.trim();
    const lon = longitude.trim();
    run(() => addManualTrackingEvent(shipmentId, {
      eventType,
      occurredAt: occurredAt || new Date().toISOString(),
      containerId: String(fd.get("containerId") ?? "") || null,
      locationName: locationName.trim() || null,
      locationUnlocode: locationUnlocode.trim() || null,
      latitude: lat ? Number(lat) : null,
      longitude: lon ? Number(lon) : null,
      description: String(fd.get("description") ?? "") || null,
      confirmCorrection,
    }));
  }

  function submitEta(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const value = String(fd.get("etaValue") ?? "");
    const source = String(fd.get("etaSource") ?? "MANUAL");
    if (!value) { setError("Date invalide."); return; }
    run(() => updateShipmentEta(shipmentId, value, source));
  }

  const badge = preview.ok
    ? preview.kind === "regress" ? "bg-amber-100 text-amber-800" : preview.kind === "cancel" || preview.kind === "exception" ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-700"
    : "bg-red-50 text-red-700";

  return (
    <section className="surface space-y-3 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Studio de suivi manuel</h2>
      <p className="text-xs text-amber-700">Chaque évènement est étiqueté « Manuel » — jamais « confirmé par le transporteur ».</p>

      <form onSubmit={submitEvent} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">Évènement
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm">
            {EVENT_OPTIONS.map((m) => <option key={m} value={m}>{m === "POSITION_UPDATE" ? "Mise à jour de position" : m === "ETA_UPDATE" ? "Mise à jour ETA (voir ci-dessous)" : milestoneLabel(m as ShippingMilestone)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Date/heure
          <input type="datetime-local" onChange={(e) => setOccurredAt(e.target.value ? new Date(e.target.value).toISOString() : "")} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
        </label>
        {containers.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-slate-600">Conteneur (optionnel)
            <select name="containerId" className="rounded-md border border-slate-200 px-2 py-1 text-sm">
              <option value="">—</option>
              {containers.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
            </select>
          </label>
        )}
        {locations.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">Lieu depuis le référentiel (optionnel — préremplit les champs ci-dessous)
            <select defaultValue="" onChange={(e) => pickLocation(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm">
              <option value="">— Choisir un port du référentiel —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-slate-600">Lieu (nom)<input value={locationName} onChange={(e) => setLocationName(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">UN/LOCODE<input value={locationUnlocode} onChange={(e) => setLocationUnlocode(e.target.value)} placeholder="SNDKR" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Latitude<input value={latitude} onChange={(e) => setLatitude(e.target.value)} inputMode="decimal" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Longitude<input value={longitude} onChange={(e) => setLongitude(e.target.value)} inputMode="decimal" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">Note / motif d&apos;exception<input name="description" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>

        {/* Effect preview — shown before submission. */}
        <div className="sm:col-span-2 space-y-1">
          <div className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>{preview.message}</div>
          {preview.outOfOrder && <p className="text-xs text-amber-700">⚠ Horodatage antérieur au dernier évènement (hors séquence).</p>}
          {preview.requiresConfirmation && (
            <label className="flex items-center gap-2 text-xs text-amber-800">
              <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} />
              Je confirme cette correction (retour à un jalon antérieur).
            </label>
          )}
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={pending || !preview.ok || eventType === "ETA_UPDATE"} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {pending ? "Enregistrement…" : "Enregistrer l'évènement"}
          </button>
        </div>
      </form>

      {/* ETA update — separate, with provenance. */}
      <form onSubmit={submitEta} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">Nouvelle ETA<input type="datetime-local" name="etaValue" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Source
          <select name="etaSource" className="rounded-md border border-slate-200 px-2 py-1 text-sm">
            <option value="MANUAL">Manuelle</option><option value="CARRIER">Transporteur</option><option value="PORT">Port</option><option value="SYSTEM_ESTIMATE">Estimation système</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">Mettre à jour l&apos;ETA</button>
      </form>

      <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
        <button onClick={() => run(() => refreshShipmentTracking(shipmentId))} disabled={pending} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Actualiser depuis le fournisseur</button>
        <span className="text-xs text-slate-400">Aucun fournisseur externe connecté (7.2A/B).</span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {ok && <p className="text-xs text-teal-700">{ok}</p>}
    </section>
  );
}
