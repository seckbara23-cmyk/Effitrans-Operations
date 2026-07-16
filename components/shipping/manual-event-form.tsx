"use client";

/**
 * Shipping — manual tracking event form (Phase 7.2A). Client component.
 * ---------------------------------------------------------------------------
 * Records a clearly-labelled MANUAL event via the server action, which re-validates
 * everything (event type, timestamp, coordinates) and rejects a forced-invalid milestone.
 * The event is always stored as source=MANUAL / confidence=MANUAL — never as
 * provider-confirmed.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualTrackingEvent, type ShippingActionResult } from "@/lib/shipping/intelligence/actions";
import { milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée.",
  not_found: "Expédition introuvable.",
  not_ocean: "Cette expédition n'est pas maritime.",
  invalid_event_type: "Type d'évènement invalide.",
  invalid_timestamp: "Date invalide.",
  invalid_coordinate: "Coordonnées invalides.",
  invalid_unlocode: "Code UN/LOCODE invalide.",
  invalid_transition: "Jalon non permis depuis l'état actuel.",
  terminal: "Expédition dans un état final.",
  complete_requires_delivery: "La clôture requiert une livraison.",
  stale_transition: "L'expédition a changé — rechargez la page.",
  duplicate_event: "Évènement déjà enregistré.",
  generic: "Une erreur est survenue.",
};

export function ManualEventForm({ shipmentId, options }: { shipmentId: string; options: ShippingMilestone[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setOk(false);
    const fd = new FormData(e.currentTarget);
    const lat = String(fd.get("latitude") ?? "").trim();
    const lon = String(fd.get("longitude") ?? "").trim();
    startTransition(async () => {
      const res: ShippingActionResult = await addManualTrackingEvent(shipmentId, {
        eventType: String(fd.get("eventType") ?? ""),
        occurredAt: String(fd.get("occurredAt") ?? "") || new Date().toISOString(),
        locationName: String(fd.get("locationName") ?? "") || null,
        locationUnlocode: String(fd.get("locationUnlocode") ?? "") || null,
        latitude: lat ? Number(lat) : null,
        longitude: lon ? Number(lon) : null,
        description: String(fd.get("description") ?? "") || null,
      });
      if (!res.ok) { setError(ERRORS[res.error] ?? ERRORS.generic); return; }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <section className="surface space-y-3 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Ajouter un évènement manuel</h2>
      <p className="text-xs text-amber-700">Les évènements manuels sont explicitement étiquetés « Manuel » et non « confirmé par le transporteur ».</p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Jalon
          <select name="eventType" className="rounded-md border border-slate-200 px-2 py-1 text-sm" required>
            {options.map((m) => <option key={m} value={m}>{milestoneLabel(m)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Date/heure
          <input type="datetime-local" name="occurredAt" className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Lieu (nom)
          <input name="locationName" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">UN/LOCODE
          <input name="locationUnlocode" placeholder="SNDKR" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Latitude (optionnel)
          <input name="latitude" inputMode="decimal" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Longitude (optionnel)
          <input name="longitude" inputMode="decimal" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">Note
          <input name="description" className="rounded-md border border-slate-200 px-2 py-1 text-sm" /></label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {pending ? "Enregistrement…" : "Enregistrer l'évènement"}
          </button>
        </div>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {ok && <p className="text-xs text-teal-700">Évènement enregistré.</p>}
    </section>
  );
}
