/**
 * Contrôle Qualité N°5 — Transport. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité » lists five controls for
 * Transport. This module reports what the transport, tracking and document
 * authorities already record. Transport performs the operation; QC5 only
 * observes it.
 *
 * FOUR DISTINCTIONS THIS MODULE REFUSES TO BLUR.
 *
 * 1. IDENTIFIED IS NOT CONFORME. `transport_record.vehicle_plate` is free text
 *    and there is NO vehicle table, inspection record or conformity fact
 *    anywhere in the schema. So the truck is IDENTIFIED and its conformity is
 *    reported as unrepresented — a plate proves which truck came, never that it
 *    was compliant.
 *
 * 2. PLANNED IS NEVER PROMOTED TO ACTUAL. `pickup_planned` / `delivery_planned`
 *    are intentions; `pickup_actual` / `delivery_actual` are facts. A missing
 *    actual reads as absent, with the plan shown as context — never as if the
 *    thing had happened.
 *
 * 3. VERIFIED IS NOT SIGNED. The document authority can prove a POD was
 *    uploaded and verified by someone other than its uploader. Nothing in the
 *    model records that the paper bears a SIGNATURE, so « POD signé » is
 *    reported as far as the evidence goes and no further.
 *
 * 4. RESTRICTED IS NOT ABSENT. Transport facts need `transport:read`, the POD
 *    needs `document:read`, and departure needs tracking to be enabled AND
 *    `tracking:read`. Each missing gate reports `restricted`, never an empty
 *    fact — which would disclose by implication what the viewer may not see.
 */
import { isVerified, canonicalStatus } from "@/lib/documents/doctrine";
import { formatTenantInstant } from "@/lib/operations/kpi/windows";
import type { DocumentItem } from "@/lib/documents/types";
import type { TransportRecord } from "@/lib/transport/types";
import type { TrackingEventEntry } from "@/lib/tracking/types";

export type QC5ControlState = "observed" | "absent" | "restricted" | "not_represented";

export type QC5Control = {
  key: string;
  labelFr: string;
  state: QC5ControlState;
  value: string | null;
  reason?: string;
};

export const QC5_NO_VEHICLE_CONFORMITY =
  "Conformité non représentée : la plateforme enregistre l'immatriculation, mais aucun référentiel véhicule, contrôle technique ou critère de conformité n'existe.";

export const QC5_NO_SIGNATURE_FACT =
  "La plateforme prouve le dépôt et la vérification de la pièce, jamais la présence d'une signature : « signé » n'est pas un fait enregistré.";

export const QC5_NO_DEPARTURE_WITHOUT_TRACKING =
  "Aucun départ enregistré : le seul fait de départ est l'événement de suivi GPS « DEPARTED », qui n'existe que si le suivi est actif sur ce dossier.";

export const RESTRICTED_TRANSPORT = "Non visible avec vos accès (transport).";
export const RESTRICTED_DOCUMENTS = "Non visible avec vos accès (documents).";

/** POD as the document authority sees it — four genuinely different states. */
export type PodState = "absent" | "uploaded" | "awaiting_verification" | "verified";

/**
 * Resolve the POD state from the AUTHORITATIVE document rows.
 *
 * Keyed on the DELIVERY_NOTE catalog type — the same predicate the dossier page
 * already uses for its delivery-proof panel, so QC5 and the operational surface
 * can never disagree about which document is the POD.
 */
export function podState(documents: readonly DocumentItem[]): PodState {
  const pods = documents.filter((d) => d.typeCode === "DELIVERY_NOTE");
  if (pods.length === 0) return "absent";
  if (pods.some((d) => isVerified(d.status))) return "verified";
  // Through the doctrine's canonicaliser: the row type still carries the narrow
  // legacy vocabulary, and comparing against it directly would silently miss
  // UNDER_REVIEW entirely.
  if (pods.some((d) => {
    const st = canonicalStatus(d.status);
    return st === "UNDER_REVIEW" || st === "PENDING_REVIEW";
  })) {
    return "awaiting_verification";
  }
  return "uploaded";
}

const POD_LABEL: Record<PodState, string> = {
  absent: "Aucune pièce déposée",
  uploaded: "Pièce déposée, non soumise à vérification",
  awaiting_verification: "Pièce en attente de vérification",
  verified: "Pièce vérifiée",
};

/** The earliest authoritative departure event, if tracking recorded one. */
export function departureEvent(events: readonly TrackingEventEntry[]): TrackingEventEntry | null {
  const departures = events.filter((e) => e.type === "DEPARTED");
  if (departures.length === 0) return null;
  return departures.reduce((earliest, e) => (e.occurredAt < earliest.occurredAt ? e : earliest));
}

export type QC5Input = {
  canReadTransport: boolean;
  canReadDocuments: boolean;
  /** True only when the tracking feature is ON and the viewer holds tracking:read. */
  canReadTracking: boolean;
  transport: TransportRecord | null;
  documents: readonly DocumentItem[];
  trackingEvents: readonly TrackingEventEntry[];
  timeZone: string;
};

export type QC5Evidence = { controls: QC5Control[]; podState: PodState | null };

export function deriveQC5(input: QC5Input): QC5Evidence {
  const tz = input.timeZone;
  // Gate FIRST. Without transport:read nothing transport-shaped is examined.
  const tr = input.canReadTransport ? input.transport : null;
  const pod = input.canReadDocuments && tr ? podState(input.documents) : null;
  const departure = input.canReadTracking ? departureEvent(input.trackingEvents) : null;

  /** Observed only when an ACTUAL instant exists. A plan never satisfies this. */
  const actualState = (actual: string | null | undefined): QC5Control["state"] =>
    actual ? "observed" : "absent";
  const plannedNote = (planned: string | null | undefined) =>
    planned ? `Planifié le ${formatTenantInstant(planned, tz)} — non confirmé.` : undefined;

  const controls: QC5Control[] = [
    {
      key: "vehicle",
      labelFr: "Camion conforme",
      // The vehicle is IDENTIFIED when a plate exists; conformity is never
      // claimed, so the control stays unrepresented even with a plate.
      state: !input.canReadTransport ? "restricted" : "not_represented",
      value: null,
      reason: !input.canReadTransport
        ? RESTRICTED_TRANSPORT
        : tr?.vehiclePlate
          ? `Véhicule identifié : ${tr.vehiclePlate}${tr.trailerOrContainer ? ` · ${tr.trailerOrContainer}` : ""}. ${QC5_NO_VEHICLE_CONFORMITY}`
          : QC5_NO_VEHICLE_CONFORMITY,
    },
    {
      key: "loadingTime",
      labelFr: "Heure de chargement",
      state: !input.canReadTransport ? "restricted" : actualState(tr?.pickupActual),
      value: tr?.pickupActual ? formatTenantInstant(tr.pickupActual, tz) : null,
      reason: !input.canReadTransport
        ? RESTRICTED_TRANSPORT
        : tr?.pickupActual
          ? "Enlèvement effectif enregistré par le transport."
          : plannedNote(tr?.pickupPlanned),
    },
    {
      key: "departureTime",
      labelFr: "Heure de départ",
      state: !input.canReadTransport
        ? "restricted"
        : departure
          ? "observed"
          : input.canReadTracking
            ? "absent"
            : "not_represented",
      value: departure ? formatTenantInstant(departure.occurredAt, tz) : null,
      reason: !input.canReadTransport
        ? RESTRICTED_TRANSPORT
        : departure
          ? "Événement de suivi « DEPARTED »."
          : QC5_NO_DEPARTURE_WITHOUT_TRACKING,
    },
    {
      key: "deliveryTime",
      labelFr: "Heure de livraison",
      state: !input.canReadTransport ? "restricted" : actualState(tr?.deliveryActual),
      value: tr?.deliveryActual ? formatTenantInstant(tr.deliveryActual, tz) : null,
      reason: !input.canReadTransport
        ? RESTRICTED_TRANSPORT
        : tr?.deliveryActual
          ? "Livraison effective enregistrée par le transport."
          : plannedNote(tr?.deliveryPlanned),
    },
    {
      key: "podSigned",
      labelFr: "POD signé",
      state: !input.canReadTransport
        ? "restricted"
        : !input.canReadDocuments
          ? "restricted"
          : pod === null || pod === "absent"
            ? "absent"
            : "observed",
      value: pod && pod !== "absent" ? POD_LABEL[pod] : null,
      reason: !input.canReadTransport
        ? RESTRICTED_TRANSPORT
        : !input.canReadDocuments
          ? RESTRICTED_DOCUMENTS
          : QC5_NO_SIGNATURE_FACT,
    },
  ];

  return { controls, podState: pod };
}
