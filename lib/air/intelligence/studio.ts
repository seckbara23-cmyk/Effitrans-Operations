/**
 * Air Cargo — manual tracking effect preview (Phase 7.3A). PURE. Reuses the air milestone
 * classifier; adds out-of-order detection + a confirmation flag for corrections. Sibling of
 * the shipping studio.
 */
import { classifyAirMilestone, isAirMilestone, airMilestoneLabel, type AirMilestone } from "./milestones";
import { isAirEvent, airEventIsMilestone, type AirEvent } from "./events";

export type AirEffectKind = "advance" | "repeat" | "regress" | "exception" | "cancel" | "position" | "eta" | "invalid";
export type AirPreview = { kind: AirEffectKind; ok: boolean; requiresConfirmation: boolean; outOfOrder: boolean; message: string; reason?: string };

export function previewAirEvent(current: AirMilestone, eventType: string, occurredAt: string | null, lastEventAt: string | null): AirPreview {
  const outOfOrder = !!occurredAt && !!lastEventAt && Number.isFinite(new Date(occurredAt).getTime()) && Number.isFinite(new Date(lastEventAt).getTime()) && new Date(occurredAt).getTime() < new Date(lastEventAt).getTime();
  if (!isAirEvent(eventType)) return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: "Type d'évènement inconnu.", reason: "invalid_event_type" };
  if (!airEventIsMilestone(eventType as AirEvent)) {
    const kind: AirEffectKind = eventType === "ETA_UPDATE" ? "eta" : "position";
    return { kind, ok: true, requiresConfirmation: false, outOfOrder, message: kind === "eta" ? "Met à jour l'ETA (manuelle)." : "Enregistre une position." };
  }
  if (!isAirMilestone(eventType)) return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: "Jalon inconnu.", reason: "invalid_event_type" };
  const verdict = classifyAirMilestone(current, eventType as AirMilestone);
  if (!verdict.ok) return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: verdict.reason === "terminal" ? "État final — transition impossible." : "Transition non permise.", reason: verdict.reason };
  const label = airMilestoneLabel(eventType as AirMilestone);
  const map: Record<Exclude<AirEffectKind, "invalid" | "position" | "eta">, string> = {
    advance: `Fait progresser vers « ${label} ».`, repeat: `Répète « ${label} ».`,
    regress: `CORRECTION : retour à « ${label} » — confirmation requise.`, exception: "Signale une EXCEPTION.", cancel: "ANNULE l'expédition.",
  };
  return { kind: verdict.kind, ok: true, requiresConfirmation: verdict.kind === "regress", outOfOrder, message: map[verdict.kind] };
}
