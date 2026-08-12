/**
 * Contrôle Qualité N°1 — Service Commercial. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité — Processus Transit & Logistique »
 * lists seven controls for the Service Commercial. This module DERIVES the
 * evidence for them from facts the commercial authority already records. It
 * stores nothing, and it is not a second commercial system: every value here is
 * read from `quotation_request` / `quotation`, which remain the only places
 * those facts exist.
 *
 * TWO RULES SHAPE EVERYTHING BELOW.
 *
 * 1. NO INVENTED CONFORMITY. The manual names « Cotation envoyée dans le délai »
 *    and « Temps de réponse au client » but supplies no threshold, and the
 *    platform has no authoritative commercial deadline either — EC-3A rule 4
 *    deliberately gave quotations no expiry date and no scheduler. So this
 *    reports the OBSERVED duration and never a verdict. « Délai constaté :
 *    48 min » is a fact; « Conforme < 2 h » would be a rule nobody ratified.
 *
 * 2. UNKNOWN IS NOT FAILURE. A control with no authoritative fact behind it
 *    reports `not_represented` with the reason, never `0` and never a red mark.
 *    Three of the seven are in that state today (see `QC1_DEFERRED`), and
 *    saying so plainly is the honest result — inventing a store for them would
 *    be a second Quality copy of Commercial activity, which the doctrine
 *    forbids: the operational fact is recorded once, and Quality reads it.
 */
import { formatTenantInstant } from "@/lib/operations/kpi/windows";
import type { QuotationRequest, Quotation } from "./service";

/** A control whose evidence the platform can and cannot supply today. */
export type QC1ControlState = "observed" | "absent" | "not_represented";

export type QC1Control = {
  /** Stable key — a future Quality phase can reference these without re-deriving. */
  key: string;
  /** The manual's own wording, preserved verbatim. */
  labelFr: string;
  state: QC1ControlState;
  /** The observed fact, already formatted for display. Null unless `observed`. */
  value: string | null;
  /**
   * Why the platform cannot speak to this control. Set only for
   * `not_represented`, so a reader never has to guess whether the silence means
   * "did not happen" or "we do not record it".
   */
  reason?: string;
};

/**
 * The three controls the platform cannot evidence today, each with the reason
 * established by repository census rather than assumed.
 *
 * These are DEFERRED, not refused: recording them needs durable data AND a
 * ratified definition, and neither exists yet. They are listed so the gap is
 * visible in the product instead of quietly missing from it.
 */
export const QC1_DEFERRED: Record<string, string> = {
  acknowledgement:
    "Aucun fait d'accusé de réception n'est enregistré aujourd'hui. La messagerie enregistre les envois, pas l'accusé lui-même.",
  followUp:
    "Aucune relance n'est enregistrée comme fait autonome. Le manuel cite « Relance effectuée » deux fois sans en préciser le contexte.",
  documentsReceived:
    "Les pièces jointes d'une demande appartiennent à la correspondance, dont l'accès est plus restreint que le commercial. Un dossier n'existe pas encore à ce stade.",
};

/** Whole minutes between two ISO instants, or null if either is unusable. */
export function minutesBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // Never negative: a response cannot precede the request it answers, and a
  // clock skew must not read as a negative delay.
  return Math.max(0, Math.round((b - a) / 60_000));
}

/** « 48 min » · « 3 h 12 min » · « 2 j 4 h ». Factual, never a verdict. */
export function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m === 0 ? `${h} h` : `${h} h ${m} min`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d} j` : `${d} j ${rh} h`;
}

/**
 * « 12/08/2026 09:02 » in the tenant's zone.
 *
 * DELEGATES to the platform's one tenant-time mechanic rather than keeping a
 * second copy — the earlier local implementation used the SERVER clock, which
 * agrees with itself on a UTC runner and is wrong everywhere else.
 */
export function formatInstant(iso: string, timeZone: string): string {
  return formatTenantInstant(iso, timeZone);
}

/**
 * The FIRST quotation actually sent to the customer for this request.
 *
 * "First" matters: a revised version supersedes an earlier one, but the moment
 * the client first heard back is the earlier send, and that is what a response
 * delay is about. Versions are compared by `sentAt`, not by version number,
 * because the number orders preparation and this orders delivery.
 */
export function firstSentQuotation(versions: readonly Quotation[]): Quotation | null {
  const sent = versions.filter((q) => q.sentAt !== null);
  if (sent.length === 0) return null;
  return sent.reduce((earliest, q) => (q.sentAt! < earliest.sentAt! ? q : earliest));
}

/** The earliest quotation prepared for the request, sent or not. */
export function firstPreparedQuotation(versions: readonly Quotation[]): Quotation | null {
  if (versions.length === 0) return null;
  return versions.reduce((earliest, q) => (q.createdAt < earliest.createdAt ? q : earliest));
}

export type QC1Evidence = {
  controls: QC1Control[];
  /** Observed response delay in minutes, or null when nothing was sent yet. */
  responseMinutes: number | null;
};

/**
 * Derive the QC1 evidence for one commercial request.
 *
 * Pure: both arguments are already loaded by the workspace, so this adds no
 * query and cannot make any listing heavier.
 */
export function deriveQC1(
  request: QuotationRequest,
  versions: readonly Quotation[],
  timeZone: string,
): QC1Evidence {
  const sent = firstSentQuotation(versions);
  const prepared = firstPreparedQuotation(versions);
  const responseMinutes = sent?.sentAt ? minutesBetween(request.createdAt, sent.sentAt) : null;

  const controls: QC1Control[] = [
    {
      key: "requestReceived",
      labelFr: "Demande reçue",
      state: "observed",
      value: formatInstant(request.createdAt, timeZone),
    },
    {
      key: "acknowledgement",
      labelFr: "Accusé de réception",
      state: "not_represented",
      value: null,
      reason: QC1_DEFERRED.acknowledgement,
    },
    {
      // The manual establishes THAT the request is analysed, never what a
      // successful analysis contains. So the evidence is that a quotation was
      // prepared for it — no checklist, no score, no criteria invented.
      key: "analysis",
      labelFr: "Analyse de la demande",
      state: prepared ? "observed" : "absent",
      value: prepared ? `Cotation préparée le ${formatInstant(prepared.createdAt, timeZone)}` : null,
    },
    {
      key: "followUp",
      labelFr: "Relance effectuée",
      state: "not_represented",
      value: null,
      reason: QC1_DEFERRED.followUp,
    },
    {
      key: "documentsReceived",
      labelFr: "Pièces reçues",
      state: "not_represented",
      value: null,
      reason: QC1_DEFERRED.documentsReceived,
    },
    {
      key: "quotationSent",
      labelFr: "Cotation envoyée",
      state: sent?.sentAt ? "observed" : "absent",
      value: sent?.sentAt
        ? `${formatInstant(sent.sentAt, timeZone)}${sent.quotationNumber ? ` — ${sent.quotationNumber}` : ""}`
        : null,
    },
    {
      // THE FACT, NOT A VERDICT. No threshold exists to judge it against.
      key: "responseDelay",
      labelFr: "Délai de réponse constaté",
      state: responseMinutes === null ? "absent" : "observed",
      value: responseMinutes === null ? null : formatDelay(responseMinutes),
    },
  ];

  return { controls, responseMinutes };
}
