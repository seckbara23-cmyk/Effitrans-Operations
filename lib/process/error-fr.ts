/**
 * ONE French vocabulary for every process refusal. PURE and client-safe.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG. Private `ERROR_FR` maps had grown on every process surface —
 * `step-actions`, `queue-row-actions`, `transit-panel`, `intake-panel`,
 * `finance-panel`, `commercial-owner` — alongside two vocabularies that live
 * with their own domain (`CONTROL_GATE_MESSAGE_FR` for the `step_gate_*` family,
 * `BILLING_ERROR_FR` for billing). Two of the private maps were byte-identical
 * for twenty-one entries. Between the others the same code carried different
 * sentences: `self_validation_forbidden` was « Vous ne pouvez pas valider votre
 * propre travail. » on one screen and « Vous avez enregistré ce BAE… » on
 * another, and `invalid_state` had five different wordings.
 *
 * Worse than the inconsistency, the maps had drifted OUT of coverage.
 * `transit-panel` can receive `evidence_missing`, `evidence_unauthorized`,
 * `prerequisites_unmet`, `handoff_not_sent` and `handoff_reception_required` and
 * had a sentence for none of them, so five precise refusals reached the operator
 * as « L'action a échoué. Réessayez. » — the exact defect UAT-00009 was about.
 * Meanwhile `intake-panel` carried sentences for `owner_forbidden` and
 * `owner_not_found`, two codes no action in this repository emits.
 *
 * A private map was the cost of every new surface. This is the last surface's
 * chance to not pay it.
 *
 * THREE VOCABULARIES, ONE RESOLVER. The engine speaks plain codes
 * (`forbidden`, `evidence_missing`); the control gate speaks `step_gate_*`;
 * billing speaks its own closed union. They are NOT merged — `BILLING_ERROR_FR`
 * is `Record<BillingError, string>` and gets compile-time exhaustiveness from
 * that, which flattening into an open record would throw away. They are
 * RESOLVED together, so a surface that mixes step actions with dossier controls
 * cannot show « L'action a échoué » for a refusal the platform can state.
 *
 * DEAD VOCABULARY IS A DEFECT, NOT PADDING (ratified UAT-00009). A sentence for
 * a code nothing emits hides the gap where a live code has none. Everything
 * below is reachable from an action a process surface actually calls, and a test
 * derives that set from the engine's own error union rather than trusting this
 * comment.
 *
 * NEVER SHOW THE CODE. `step_closed`, `assigned_to_another`, `evidence_missing`
 * are internal names. Everything an operator reads comes out of this file.
 */
import { stepGateMessageFr } from "./control-gate";
import { BILLING_ERROR_FR } from "./billing/state";

/** What we say when we genuinely do not know. Should be reached by nothing. */
export const PROCESS_ERROR_GENERIC = "L'action a échoué. Veuillez réessayer.";

/**
 * The canonical sentence for every refusal the process surfaces can receive.
 *
 * Where two maps disagreed, the sentence here is the one true in BOTH
 * situations — never the narrower one, because the narrower one was wrong
 * somewhere.
 */
export const PROCESS_ERROR_FR: Record<string, string> = {
  // ---- availability ------------------------------------------------------
  // Four modules emit this behind four different flags, so the canonical
  // sentence names none of them. Surfaces that know which flag it was narrow it
  // in SURFACE_ERROR_FR below.
  engine_disabled: "Le module de processus concerné n'est pas activé sur cette plateforme.",
  finance_disabled: "Le flux d'exécution Finance n'est pas activé.",

  // ---- authority ---------------------------------------------------------
  forbidden: "Action non autorisée.",
  // Emitted by the workflow policy resolver and declared in EngineError. It
  // says nothing more than `forbidden` to an operator, on purpose: which
  // tenant a row belongs to is not something a refusal should disclose.
  cross_tenant: "Action non autorisée.",
  not_authorized_assigner: "Cette affectation relève du Chef de Transit.",
  not_authorized_approver:
    "La vérification finale avant le Transport relève du Chef de Transit.",
  not_authorized_sender: "Vous n'êtes pas habilité à effectuer cette transmission.",
  not_eligible_receiver: "Ce transfert ne vous est pas destiné.",
  override_not_allowed: "Dérogation non autorisée.",
  actor_invalid: "Votre compte n'est plus actif dans cette organisation.",
  invalid_assignee: "La personne choisie n'est pas un compte actif de l'organisation.",

  // ---- identity of the thing ---------------------------------------------
  not_found:
    "Élément introuvable : le dossier ou l'étape concernée n'existe pas, ou ne vous est plus visible.",
  unknown_step: "Étape inconnue.",

  // ---- claim and assignment ----------------------------------------------
  step_assigned_to_other: "Cette étape est affectée à une autre personne.",
  owner_required: "Le responsable ne peut pas être retiré sans remplaçant.",
  owner_unchanged: "Ce responsable est déjà désigné.",
  file_terminal:
    "Le dossier est clôturé ou annulé : cette désignation ne peut plus changer.",
  assign_failed: "La désignation a échoué.",

  // ---- sequence and state ------------------------------------------------
  // Five wordings collapsed into one true whether the refusal means "your page
  // is stale" (the compare-and-set lost) or "not in this state".
  invalid_state:
    "Action impossible dans l'état actuel : il a changé depuis l'affichage de cette page. Rafraîchissez pour voir la situation à jour.",
  prerequisites_unmet: "Prérequis non satisfaits.",
  // OPS-SERVICE-SCOPE-01. Deliberately NOT phrased as a blockage: nothing is
  // missing, the service was simply not contracted. The remedy is « Sans
  // objet », not a document.
  step_not_applicable:
    "Cette étape ne s'applique pas à ce dossier : le service correspondant n'a pas été demandé. Marquez-la « Sans objet » si elle apparaît encore.",
  gate_blocked: "Porte de convergence bloquée.",
  from_step_incomplete: "L'étape d'origine du transfert n'est pas terminée.",
  am_opening_incomplete:
    "Transmission impossible : l'étape d'ouverture et de préparation du dossier n'est pas terminée.",
  transition_failed: "Le statut du dossier n'a pas pu être mis à jour. Réessayez.",

  // ---- custody and transmission ------------------------------------------
  handoff_not_sent: "Le dossier doit d'abord être formellement transmis au service suivant.",
  handoff_not_open: "Ce transfert n'est plus en attente.",
  handoff_reception_required:
    "Réceptionnez d'abord le dossier : cette étape vous a été transmise.",
  transit_custody_required:
    "Le Transit doit d'abord réceptionner le dossier et terminer sa réception.",

  // ---- evidence ----------------------------------------------------------
  evidence_missing: "Preuves requises manquantes.",
  evidence_unauthorized:
    "Vous n'avez pas accès aux preuves exigées par cette étape. "
    + "Elle doit être clôturée par une personne habilitée à les consulter.",

  // ---- maker / checker ---------------------------------------------------
  // ONE sentence for a code two surfaces described differently. The BAE-specific
  // wording was true of the mainlevée verification and false of every other
  // step; this one is true of both, and still names the consequence.
  self_validation_forbidden:
    "Vous ne pouvez pas valider votre propre travail : cette vérification revient à une autre personne.",
  self_review_forbidden: "Le demandeur ne peut pas réviser sa propre demande.",
  self_verification_forbidden:
    "L'exécutant du décaissement ne peut pas vérifier son propre justificatif.",
  release_not_approved:
    "Le Chef de Transit n'a pas encore vérifié ce BAE : la libération reste bloquée.",

  // ---- inputs ------------------------------------------------------------
  reason_required: "Un motif est obligatoire.",

  // ---- intake ------------------------------------------------------------
  intake_incomplete: "Informations obligatoires manquantes — corrigez les points bloquants.",
  blocked_by_intake_blockers:
    "Transmission refusée : des points bloquants sont ouverts sur ce dossier.",

  // ---- finance -----------------------------------------------------------
  clearance_not_ready: "Le feu vert financier n'est pas encore possible.",
  not_reimbursable: "Cette dépense n'est pas refacturable au client.",
};

/**
 * Sentences a specific surface may substitute for a canonical one, and the only
 * legitimate reason to: the code names a fact whose canonical wording is
 * necessarily vaguer than what this surface knows for certain.
 *
 * Deliberately small, deliberately HERE rather than in the components. A new
 * entry has to justify itself in front of the canonical sentence it narrows,
 * and a test counts them so this cannot quietly become a seventh map.
 */
export const SURFACE_ERROR_FR = {
  /** `engine_disabled` on this surface is always the Transit execution flag. */
  transit: { engine_disabled: "Le flux d'exécution Transit n'est pas activé." },
  /** …and here it is always the intake flag. */
  intake: { engine_disabled: "Le flux d'ouverture n'est pas activé." },
  /** Finance has its own kill-switch code; nothing to narrow. */
  finance: {} as Record<string, string>,
  /** The queue's staleness advice names the thing it can refresh. */
  queue: {
    invalid_state:
      "L'étape a déjà changé d'état depuis l'affichage de cette file. Rafraîchissez-la pour voir la situation à jour.",
  },
  /** Designating the Responsable client: every refusal is about that act. */
  commercialOwner: {
    forbidden: "Vous n'avez pas l'autorité pour désigner le Responsable client.",
    not_found: "Dossier introuvable.",
    owner_required: "Le Responsable client ne peut pas être retiré sans remplaçant.",
    owner_unchanged: "Ce Responsable client est déjà désigné.",
    file_terminal:
      "Le dossier est clôturé ou annulé : le Responsable client ne peut plus changer.",
    reason_required: "Un remplacement exige un motif détaillé.",
  },
} as const satisfies Record<string, Record<string, string>>;

export type ProcessErrorSurface = keyof typeof SURFACE_ERROR_FR;

/**
 * The operator-facing sentence for a refusal code — from ANY of the three
 * vocabularies.
 *
 * Always returns something readable, and never the code itself. Pass `surface`
 * only to pick up that surface's narrower wording where one is enumerated
 * above.
 */
export function processErrorFr(
  code: string | null | undefined,
  surface?: ProcessErrorSurface,
): string {
  if (typeof code !== "string" || code.length === 0) return PROCESS_ERROR_GENERIC;
  // The control gate's own family, resolved through its own accessor so the two
  // vocabularies cannot drift apart.
  const gate = stepGateMessageFr(code);
  if (gate) return gate;
  const narrowed = surface
    ? (SURFACE_ERROR_FR[surface] as Record<string, string>)[code]
    : undefined;
  return (
    narrowed
    ?? PROCESS_ERROR_FR[code]
    ?? (BILLING_ERROR_FR as Record<string, string>)[code]
    ?? PROCESS_ERROR_GENERIC
  );
}

/**
 * Did we actually have a sentence for this code?
 *
 * `processErrorFr` always returns a string, which is right for a UI and useless
 * for a contract test — it would go green while a live code fell through to the
 * generic sentence. This is what the coverage tests assert on.
 */
export function hasProcessErrorFr(code: string, surface?: ProcessErrorSurface): boolean {
  return processErrorFr(code, surface) !== PROCESS_ERROR_GENERIC;
}

/** Why a required artefact does not count yet — the evaluator's own words. */
export const EVIDENCE_STATUS_FR: Record<string, string> = {
  missing: "manquant",
  invalid: "rejeté ou expiré",
  pending_review: "en attente de validation",
  unauthorized: "non consultable par vous",
};
