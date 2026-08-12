/**
 * Contrôle Qualité N°4 — Opérations Transit. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité » lists seven controls for
 * Opérations Transit. This module derives what the platform can truthfully say
 * from authorities that already exist — `customs_record`, the document
 * authority, and the official SLA policy registry — and states plainly where it
 * can say nothing.
 *
 * FOUR REFUSALS, each established by census rather than assumed.
 *
 * 1. NO CHECKLIST IS INVENTED. The manual says « Respect checklist »; no Transit
 *    checklist référentiel exists in the platform. Building a generic checklist
 *    engine because the manual uses the word would be inventing the very thing
 *    Effitrans has not defined.
 *
 * 2. « SYNCHRONISÉ » IS NEVER CLAIMED. GAINDE has no API contract — the provider
 *    config reports it `unsupported` (BLK-1: no base URL, auth, schemas), and
 *    `customs_record.external_ref` is documented as a MANUAL reference. ORBUS
 *    has no data model at all. So a customs reference is reported with its
 *    PROVENANCE, never as evidence of a live link.
 *
 * 3. ELAPSED TIME IS NOT COMPLIANCE. Every Transit SLA policy that bears on QC4
 *    — `bae_followup`, `customs_followup`, `customs_document_submission`,
 *    `chief_transit_validation` — is `unconfigured` in the official registry,
 *    whose own doctrine is that an unconfigured policy "must NEVER produce an
 *    overdue/late status". The duration is a fact; the verdict does not exist.
 *
 * 4. RESTRICTED IS NOT ABSENT. Customs facts require `customs:read` and document
 *    facts require `document:read`. Without them QC4 reports `restricted` — it
 *    never shows an empty tally or a missing BAE, which would disclose by
 *    implication what the viewer may not see.
 */
import { isVerified } from "@/lib/documents/doctrine";
import { formatTenantInstant } from "@/lib/operations/kpi/windows";
import { PROCESS_SLA_POLICIES, type SlaPolicy } from "@/lib/process/sla-policies";
import { tallyDocuments, describeTally, type QC2DocumentTally } from "./qc2";
import type { DocumentItem } from "@/lib/documents/types";
import type { CustomsRecord } from "@/lib/customs/types";

export type QC4ControlState = "observed" | "absent" | "restricted" | "not_represented";

export type QC4Control = {
  key: string;
  labelFr: string;
  state: QC4ControlState;
  value: string | null;
  reason?: string;
};

export const QC4_NO_CHECKLIST =
  "Non évalué : aucun référentiel de checklist Transit n'est défini dans la plateforme.";

/**
 * MAYA-P0.8-A closed the software half of this control: a validation can now be
 * recorded. What remains open is the BUSINESS half — whether a Chef de Transit
 * validation is what « exactitude des informations » means. So a recorded
 * validation is reported as the fact it is, and never as a verdict.
 */
export const QC4_NO_VALIDATION_RECORD =
  "Aucune validation enregistrée à ce jour. La séparation préparateur/valideur existe (customs:validate, réservé au Chef de Transit).";

export const QC4_VALIDATION_IS_NOT_A_VERDICT =
  "Fait opérationnel enregistré. Le critère qualité « exactitude des informations » n'est pas défini : ce constat ne vaut pas conformité.";

/**
 * « Transmission rapide des documents » names no recipient. The platform records
 * sharing with the CLIENT (`document.shared_with_client`), which is a different
 * act from transmitting a file onward inside Transit. Mapping one onto the other
 * would report the wrong event.
 */
export const QC4_NO_TRANSMISSION_FACT =
  "Non représenté : la plateforme enregistre le partage avec le client, pas une transmission interne « aux opérations » — le destinataire de ce contrôle n'est pas défini.";

export const RESTRICTED_CUSTOMS = "Non visible avec vos accès (douane).";
export const RESTRICTED_DOCUMENTS = "Non visible avec vos accès (documents).";

/** Look a policy up in the OFFICIAL registry — never a local copy of a number. */
export function slaPolicy(key: string): SlaPolicy | null {
  return PROCESS_SLA_POLICIES.find((p) => p.key === key) ?? null;
}

/**
 * How a threshold should be described, in the registry's own vocabulary.
 *
 * `unconfigured` → there is no number, and none may be invented.
 * `unratified`   → a number is live but management never approved it, so it is
 *                  reported as such rather than presented as a target.
 */
export function describeThreshold(key: string): string {
  const p = slaPolicy(key);
  if (!p || p.state === "unconfigured") return "seuil non configuré";
  if (p.state === "unratified") return `seuil ${p.warningHours} h (non ratifié)`;
  return `seuil ${p.warningHours} h`;
}

/** Whole hours between two ISO instants; null when either is unusable. */
export function hoursBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 3_600_000));
}

/** « 17 h » · « 3 j 4 h ». A measured fact, never a verdict. */
export function formatHours(h: number): string {
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d} j` : `${d} j ${rh} h`;
}

export type QC4Input = {
  canReadCustoms: boolean;
  canReadDocuments: boolean;
  /** Null when absent OR when the viewer may not read customs — see the flag. */
  customs: CustomsRecord | null;
  documents: readonly DocumentItem[];
  missingRequiredCount: number;
  timeZone: string;
};

export type QC4Evidence = {
  controls: QC4Control[];
  tally: QC2DocumentTally | null;
};

/** The BAE as the document authority sees it: present, and verified or not. */
export function baeDocumentState(
  documents: readonly DocumentItem[],
): "verified" | "present_unverified" | "absent" {
  const bae = documents.filter((d) => d.typeCode === "BAE");
  if (bae.length === 0) return "absent";
  return bae.some((d) => isVerified(d.status)) ? "verified" : "present_unverified";
}

export function deriveQC4(input: QC4Input): QC4Evidence {
  const tz = input.timeZone;
  // Permission gates FIRST — a restricted viewer must not reach a branch that
  // renders an absence indistinguishable from a real one.
  const tally = input.canReadDocuments
    ? tallyDocuments(input.documents, input.missingRequiredCount)
    : null;
  const c = input.canReadCustoms ? input.customs : null;

  // Time from declaration to release: both instants are authoritative customs
  // facts. The threshold for it (`bae_followup`) is unconfigured, so only the
  // duration is reported.
  const baeHours =
    c?.declarationDate && c?.releaseDate ? hoursBetween(c.declarationDate, c.releaseDate) : null;

  const controls: QC4Control[] = [
    {
      key: "checklist",
      labelFr: "Respect checklist",
      state: "not_represented",
      value: null,
      reason: QC4_NO_CHECKLIST,
    },
    {
      // MAYA-P0.8-A — the Chef de Transit validation is now recordable, so this
      // control has an authoritative fact to reference. It reports WHO and WHEN
      // and stops there: whether that validation SATISFIES « exactitude des
      // informations » is a criterion nobody has ratified.
      key: "informationAccuracy",
      labelFr: "Exactitude des informations",
      state: !input.canReadCustoms ? "restricted" : c?.reviewedAt ? "observed" : "absent",
      value: c?.reviewedAt
        ? `Validation Chef de Transit le ${formatTenantInstant(c.reviewedAt, tz)}${
            c.reviewedByEmail ? ` — ${c.reviewedByEmail}` : ""
          }`
        : null,
      reason: !input.canReadCustoms
        ? RESTRICTED_CUSTOMS
        : c?.reviewedAt
          ? QC4_VALIDATION_IS_NOT_A_VERDICT
          : QC4_NO_VALIDATION_RECORD,
    },
    {
      key: "documentaryConformity",
      labelFr: "Conformité documentaire",
      state: !input.canReadDocuments ? "restricted" : tally!.received === 0 ? "absent" : "observed",
      value: tally && tally.received > 0 ? describeTally(tally) : null,
      reason: !input.canReadDocuments ? RESTRICTED_DOCUMENTS : undefined,
    },
    {
      key: "customsTracking",
      labelFr: "Suivi ORBUS / GAINDE",
      state: !input.canReadCustoms ? "restricted" : c?.externalRef || c?.declarationNumber ? "observed" : "absent",
      value:
        c && (c.externalRef || c.declarationNumber)
          ? `${c.externalRef ?? c.declarationNumber} — source : ${
              c.providerCode === "manual" ? "saisie manuelle" : c.providerCode
            }${c.providerSyncedAt ? ` · ${formatTenantInstant(c.providerSyncedAt, tz)}` : ""}`
          : null,
      reason: !input.canReadCustoms
        ? RESTRICTED_CUSTOMS
        : "Aucune intégration ORBUS/GAINDE en service : les références sont suivies manuellement.",
    },
    {
      key: "bae",
      labelFr: "Obtention du BAE",
      state: !input.canReadCustoms ? "restricted" : c?.baeReference ? "observed" : "absent",
      value: c?.baeReference
        ? `${c.baeReference}${c.releaseDate ? ` — obtenu le ${formatTenantInstant(c.releaseDate, tz)}` : ""}${
            input.canReadDocuments
              ? baeDocumentState(input.documents) === "verified"
                ? " · pièce vérifiée"
                : baeDocumentState(input.documents) === "present_unverified"
                  ? " · pièce en attente de vérification"
                  : " · pièce non déposée"
              : ""
          }`
        : null,
      reason: !input.canReadCustoms ? RESTRICTED_CUSTOMS : undefined,
    },
    {
      key: "documentTransmission",
      labelFr: "Transmission rapide des documents",
      state: "not_represented",
      value: null,
      reason: QC4_NO_TRANSMISSION_FACT,
    },
    {
      key: "internalDelay",
      labelFr: "Respect du délai interne",
      state: !input.canReadCustoms ? "restricted" : baeHours === null ? "absent" : "observed",
      value: baeHours === null ? null : `Durée constatée : ${formatHours(baeHours)}`,
      reason: !input.canReadCustoms
        ? RESTRICTED_CUSTOMS
        : `Déclaration → BAE · ${describeThreshold("bae_followup")}`,
    },
  ];

  return { controls, tally };
}
