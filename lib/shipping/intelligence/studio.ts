/**
 * Shipping Line Platform — Manual Tracking Studio logic (Phase 7.2B). PURE.
 * ---------------------------------------------------------------------------
 * The studio shows an operator the EFFECT of a manual event before they submit it. This
 * reuses the 7.2A milestone classifier — it does not re-implement transition rules — and
 * adds an out-of-order timestamp check and a "needs confirmation" flag for corrections /
 * regressions. No I/O.
 */
import { classifyMilestone, isShippingMilestone, milestoneLabel, type ShippingMilestone } from "./milestones";
import { eventIsMilestone, isCanonicalEvent, type CanonicalShippingEvent } from "./events";

export type StudioEffectKind = "advance" | "repeat" | "regress" | "exception" | "cancel" | "complete" | "position" | "eta" | "invalid";

export type StudioPreview = {
  kind: StudioEffectKind;
  ok: boolean;
  requiresConfirmation: boolean;
  outOfOrder: boolean;
  message: string;
  reason?: string;
};

/**
 * Preview applying `eventType` at `occurredAt` to a shipment currently at `current`, whose
 * last event occurred at `lastEventAt`. Deterministic; drives both the UI preview and (as a
 * guard) the server action. Regressions/corrections require explicit confirmation.
 */
export function previewManualEvent(
  current: ShippingMilestone,
  eventType: string,
  occurredAt: string | null,
  lastEventAt: string | null,
): StudioPreview {
  const outOfOrder =
    !!occurredAt && !!lastEventAt &&
    Number.isFinite(new Date(occurredAt).getTime()) && Number.isFinite(new Date(lastEventAt).getTime()) &&
    new Date(occurredAt).getTime() < new Date(lastEventAt).getTime();

  if (!isCanonicalEvent(eventType)) {
    return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: "Type d'évènement inconnu.", reason: "invalid_event_type" };
  }
  // Non-milestone events (position / ETA) never change the milestone.
  if (!eventIsMilestone(eventType as CanonicalShippingEvent)) {
    const kind: StudioEffectKind = eventType === "ETA_UPDATE" ? "eta" : "position";
    return { kind, ok: true, requiresConfirmation: false, outOfOrder, message: kind === "eta" ? "Met à jour l'ETA (source manuelle)." : "Enregistre une position (sans changer le jalon)." };
  }
  if (!isShippingMilestone(eventType)) {
    return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: "Jalon inconnu.", reason: "invalid_event_type" };
  }
  const verdict = classifyMilestone(current, eventType as ShippingMilestone);
  if (!verdict.ok) {
    const msg = verdict.reason === "terminal" ? "Expédition dans un état final — transition impossible." : "Transition non permise depuis l'état actuel.";
    return { kind: "invalid", ok: false, requiresConfirmation: false, outOfOrder, message: msg, reason: verdict.reason };
  }
  const label = milestoneLabel(eventType as ShippingMilestone);
  const requiresConfirmation = verdict.kind === "regress"; // corrections must be confirmed
  const message: Record<Exclude<StudioEffectKind, "invalid" | "position" | "eta">, string> = {
    advance: `Fait progresser le jalon vers « ${label} ».`,
    repeat: `Répète le jalon actuel « ${label} ».`,
    regress: `CORRECTION : revient à « ${label} » (antérieur à l'état actuel) — confirmation requise.`,
    exception: "Signale une EXCEPTION (blocage) sur l'expédition.",
    cancel: "ANNULE l'expédition (état final).",
    complete: `Clôture l'expédition (« ${label} »).`,
  };
  return { kind: verdict.kind, ok: true, requiresConfirmation, outOfOrder, message: message[verdict.kind] };
}
