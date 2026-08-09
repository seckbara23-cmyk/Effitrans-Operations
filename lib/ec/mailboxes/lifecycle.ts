/**
 * EMP-5F — the governed mailbox lifecycle. PURE, no I/O, no clock.
 *
 * RÉSERVER → CONFIGURER → VÉRIFIER → ACTIVER.
 *
 * WHAT WENT WRONG. `ACTIVE` meant "an operator clicked success". The production
 * mailbox was reserved and marked ACTIVE nineteen seconds later with an empty
 * note — no external mailbox can be created and verified in nineteen seconds,
 * so that ACTIVE records an assertion, not an observation. And the column
 * defaulted to `'ACTIVE'`, so an insert that merely forgot it produced an
 * operational mailbox that passed no gate at all.
 *
 * THE ONE AUTHORITY. `activationGuard` is the single place activation rules
 * live. Scattering them across UI components is how a rule gets enforced on one
 * screen and forgotten on another, so the panel does not decide anything: it
 * asks this module what is permitted and renders the answer.
 *
 * THE GUARD IS PURE AND TAKES `now`. A rule that reads the clock cannot be
 * tested for staleness without waiting, and a rule that reads the database
 * cannot be tested without one. Everything here is a function of its arguments.
 *
 * WHAT THIS MODULE CANNOT DO. It cannot contact a provider, check DNS, or
 * observe a mailbox. No such integration exists, and pretending otherwise would
 * be the same lie in a new place. It decides whether the EVIDENCE RECORDED BY
 * PEOPLE is sufficient, and labels that evidence as manual where it is manual.
 */

// ---------------------------------------------------------------------------
// 1. The vocabulary
// ---------------------------------------------------------------------------

export const MAILBOX_STATES = [
  "RESERVED",
  "CONFIGURATION_REQUIRED",
  "CONFIGURED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "ACTIVE",
  "FAILED",
  "DISABLED",
] as const;
export type MailboxState = (typeof MAILBOX_STATES)[number];

/**
 * EMP-4A's spellings, mapped to the canonical model.
 *
 * Rows hold these today and will hold them forever — renaming stored values
 * would rewrite what a row remembers. They are READ here and never written
 * again, which is why this map is the only place they appear.
 */
export const LEGACY_STATE_ALIASES: Record<string, MailboxState> = {
  DRAFT: "RESERVED",
  PENDING_EXTERNAL_SETUP: "CONFIGURATION_REQUIRED",
  SETUP_FAILED: "FAILED",
};

export function isMailboxState(v: unknown): v is MailboxState {
  return typeof v === "string" && (MAILBOX_STATES as readonly string[]).includes(v);
}

/**
 * The canonical state of a stored value.
 *
 * An unrecognised value resolves to RESERVED — the least operational state.
 * Guessing upward from something we do not understand is how an unknown becomes
 * an ACTIVE mailbox.
 */
export function canonicalState(stored: string | null | undefined): MailboxState {
  const v = (stored ?? "").trim();
  if (isMailboxState(v)) return v;
  return LEGACY_STATE_ALIASES[v] ?? "RESERVED";
}

export const STATE_FR: Record<MailboxState, string> = {
  RESERVED: "Réservée",
  CONFIGURATION_REQUIRED: "Configuration requise",
  CONFIGURED: "Configurée",
  PENDING_VERIFICATION: "Vérification en cours",
  VERIFIED: "Vérifiée",
  ACTIVE: "Active",
  FAILED: "Échec",
  DISABLED: "Désactivée",
};

export const STATE_MEANING_FR: Record<MailboxState, string> = {
  RESERVED:
    "L'identité interne est enregistrée. Aucune affirmation n'est faite sur "
    + "l'existence d'une boîte chez le fournisseur.",
  CONFIGURATION_REQUIRED:
    "Une intervention externe ou côté messagerie d'entreprise est nécessaire.",
  CONFIGURED:
    "La relation fournisseur ou l'identité externe est enregistrée. Le "
    + "fonctionnement n'est pas encore prouvé.",
  PENDING_VERIFICATION:
    "Les vérifications de disponibilité sont en attente de résultat.",
  VERIFIED:
    "Les preuves requises existent et sont à jour. La boîte n'est pas encore "
    + "mise en service.",
  ACTIVE:
    "Vérifiée et explicitement mise en service. « Active » n'est pas un "
    + "raccourci pour « un opérateur a cliqué sur succès ».",
  FAILED:
    "La configuration ou la vérification a échoué, avec un motif enregistré.",
  DISABLED:
    "Rendue indisponible par décision administrative. Réversible.",
};

/** Routing follows this and only this — `is_active` is derived from it by a
 *  database trigger, so it is not a second lifecycle. */
export function isOperational(state: MailboxState): boolean {
  return state === "ACTIVE";
}

// ---------------------------------------------------------------------------
// 2. The facts a lifecycle decision needs. All already stored.
// ---------------------------------------------------------------------------

export type LifecycleFacts = {
  id: string;
  tenantId: string;
  address: string;
  mailboxType: string;
  ownerUserId: string | null;
  provisioningStatus: string;
  provisioningNote: string | null;
  ownership: string;
  externalProvider: string | null;
  externalMailboxId: string | null;
  corporateIdentityConfirmedAt: string | null;
  corporateIdentityConfirmedBy: string | null;
  outboundVerifiedAt: string | null;
  outboundVerifiedBy: string | null;
  outboundVerificationRef: string | null;
  inboundVerifiedAt: string | null;
  inboundVerifiedBy: string | null;
  inboundVerificationRef: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
};

/**
 * Evidence freshness.
 *
 * NO WINDOW IS IMPOSED BY DEFAULT, and that is deliberate rather than an
 * oversight. "Evidence older than N days is stale" is a policy Effitrans must
 * choose; picking a number here would be inventing one and then enforcing it on
 * a live system. The MECHANISM exists and is tested; the VALUE is RATIFY-EMP5F-1.
 *
 * Corporate identity and capability evidence are separate because they decay
 * differently: an address existing is not the kind of fact that expires on a
 * timer, whereas "sending worked" plausibly is.
 */
export type EvidencePolicy = {
  identityMaxAgeDays: number | null;
  capabilityMaxAgeDays: number | null;
};

export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = {
  identityMaxAgeDays: null,
  capabilityMaxAgeDays: null,
};

function ageInDays(at: string | null, now: string): number | null {
  if (!at) return null;
  const a = Date.parse(at);
  const n = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return null;
  return (n - a) / 86_400_000;
}

function isStale(at: string | null, now: string, maxAgeDays: number | null): boolean {
  if (maxAgeDays === null) return false;
  const age = ageInDays(at, now);
  return age !== null && age > maxAgeDays;
}

// ---------------------------------------------------------------------------
// 3. Legacy-active — derived, never stored
// ---------------------------------------------------------------------------

/**
 * An ACTIVE mailbox that never passed through the governed activation.
 *
 * Detected with ZERO inference: `activated_by` is NULL only because nobody ever
 * activated it through the guard. There is no marker column, because a derived
 * fact that becomes a stored one starts drifting the day it is written.
 *
 * These rows are SURFACED, never rewritten. Silently deactivating a mailbox the
 * company may be using is precisely the disruption this programme forbids.
 */
export function isLegacyActive(m: Pick<LifecycleFacts, "provisioningStatus" | "activatedBy">): boolean {
  return canonicalState(m.provisioningStatus) === "ACTIVE" && !m.activatedBy;
}

// ---------------------------------------------------------------------------
// 4. Readiness checks — only what platform data can actually prove
// ---------------------------------------------------------------------------

/**
 * `automated` means the platform derived it from data it holds.
 * `manual` means a person asserted it and the platform recorded who and when.
 *
 * Every capability check is MANUAL today, because no provider integration
 * exists. Labelling them honestly is the point: an administrator reading
 * "vérifié" deserves to know whether a machine observed it or a colleague said so.
 */
export type EvidenceKind = "automated" | "manual";

export type ReadinessCheck = {
  code: string;
  labelFr: string;
  passed: boolean;
  kind: EvidenceKind;
  detailFr: string;
};

export function readinessChecks(
  m: LifecycleFacts,
  actorTenantId: string,
  now: string,
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
): ReadinessCheck[] {
  const addressValid =
    typeof m.address === "string"
    && m.address === m.address.toLowerCase()
    && m.address.includes("@")
    && m.address.length >= 3 && m.address.length <= 320;

  const typeCoherent =
    m.mailboxType === "PERSONAL" ? Boolean(m.ownerUserId) : !m.ownerUserId;

  const identityFresh = !isStale(m.corporateIdentityConfirmedAt, now, policy.identityMaxAgeDays);

  return [
    { code: "ADDRESS_VALID", labelFr: "Adresse valide", kind: "automated",
      passed: addressValid,
      detailFr: "Forme de l'adresse vérifiée par la plateforme." },
    { code: "TENANT_MATCH", labelFr: "Appartient à ce tenant", kind: "automated",
      passed: m.tenantId === actorTenantId,
      detailFr: "Comparaison directe des identifiants de tenant." },
    { code: "TYPE_COHERENT", labelFr: "Type et titulaire cohérents", kind: "automated",
      passed: typeCoherent,
      detailFr: "Une boîte personnelle nomme son titulaire ; une boîte partagée ou fonctionnelle n'en a pas." },
    { code: "OWNERSHIP_KNOWN", labelFr: "Provenance établie", kind: "manual",
      passed: m.ownership !== "UNKNOWN",
      detailFr: "Gérée par la plateforme ou existante dans la messagerie d'entreprise — déclaré par une personne." },
    { code: "EXTERNAL_REFERENCE", labelFr: "Référence externe enregistrée", kind: "manual",
      passed: Boolean(m.externalProvider || m.externalMailboxId),
      detailFr: "Fournisseur ou identifiant de boîte chez le fournisseur, saisi par une personne." },
    { code: "IDENTITY_CONFIRMED", labelFr: "Identité d'entreprise confirmée", kind: "manual",
      passed: Boolean(m.corporateIdentityConfirmedAt) && identityFresh,
      detailFr: "Une personne identifiée a confirmé que l'adresse existe réellement." },
    { code: "OUTBOUND_EVIDENCE", labelFr: "Preuve d'envoi enregistrée", kind: "manual",
      passed: Boolean(m.outboundVerifiedAt && m.outboundVerificationRef)
              && !isStale(m.outboundVerifiedAt, now, policy.capabilityMaxAgeDays),
      detailFr: "Aucune intégration fournisseur n'existe : cette preuve est saisie et référencée par une personne." },
    { code: "INBOUND_EVIDENCE", labelFr: "Preuve de réception enregistrée", kind: "manual",
      passed: Boolean(m.inboundVerifiedAt && m.inboundVerificationRef)
              && !isStale(m.inboundVerifiedAt, now, policy.capabilityMaxAgeDays),
      detailFr: "Référence vers un événement de capture réellement observé, saisie par une personne." },
  ];
}

/**
 * Capability readiness, INDEPENDENT per direction (the EMP-5F Option B choice).
 *
 * Requiring inbound proof before permitting outbound use would block a
 * legitimate outbound-only arrangement — and Effitrans's coexistence design may
 * well end up outbound-only, with inbound fed by a provider-side copy rule that
 * does not exist yet. ACTIVE describes the IDENTITY being operational; sending
 * and receiving are gated by their own evidence on top of it.
 */
export type CapabilityReadiness = {
  identityConfirmed: boolean;
  outboundReady: boolean;
  inboundReady: boolean;
};

export function capabilityReadiness(
  m: LifecycleFacts,
  now: string,
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
): CapabilityReadiness {
  const operational = isOperational(canonicalState(m.provisioningStatus));
  const identityConfirmed =
    m.ownership !== "UNKNOWN"
    && Boolean(m.corporateIdentityConfirmedAt)
    && !isStale(m.corporateIdentityConfirmedAt, now, policy.identityMaxAgeDays);

  return {
    identityConfirmed,
    outboundReady: operational && identityConfirmed
      && Boolean(m.outboundVerifiedAt && m.outboundVerificationRef)
      && !isStale(m.outboundVerifiedAt, now, policy.capabilityMaxAgeDays),
    inboundReady: operational && identityConfirmed
      && Boolean(m.inboundVerifiedAt && m.inboundVerificationRef)
      && !isStale(m.inboundVerifiedAt, now, policy.capabilityMaxAgeDays),
  };
}

// ---------------------------------------------------------------------------
// 5. THE ACTIVATION GUARD — the single authority
// ---------------------------------------------------------------------------

export type ActivationBlockerCode =
  | "NO_ACTOR"
  | "FORBIDDEN"
  | "CROSS_TENANT"
  | "UNRESOLVED_FAILURE"
  | "WRONG_STATE"
  | "TYPE_INCOMPATIBLE"
  | "OWNERSHIP_UNKNOWN"
  | "EXTERNAL_REFERENCE_MISSING"
  | "CORPORATE_IDENTITY_UNCONFIRMED"
  | "EVIDENCE_STALE"
  | "NO_VERIFIER_RECORDED"
  | "MAKER_CHECKER_SAME_ACTOR";

export type ActivationBlocker = { code: ActivationBlockerCode; messageFr: string };

/** The acting administrator. `id` is nullable so an unauthenticated or SYSTEM
 *  caller is a REPRESENTABLE input that the guard can refuse — rather than a
 *  case the type system hides and the runtime meets anyway. */
export type ActivationActor = {
  id: string | null;
  tenantId: string;
  canProvision: boolean;
};

export type ActivationDecision = {
  allowed: boolean;
  blockers: ActivationBlocker[];
};

/**
 * May this actor activate this mailbox, now?
 *
 * Returns EVERY blocker rather than the first. An administrator fixing one
 * problem at a time, discovering the next only after the last, is how a
 * verification step becomes theatre.
 */
export function activationGuard(input: {
  actor: ActivationActor | null;
  mailbox: LifecycleFacts;
  now: string;
  policy?: EvidencePolicy;
}): ActivationDecision {
  const { actor, mailbox: m, now } = input;
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const blockers: ActivationBlocker[] = [];
  const add = (code: ActivationBlockerCode, messageFr: string) =>
    blockers.push({ code, messageFr });

  // --- authority ----------------------------------------------------------
  // RATIFY-OPSSEC2-2A: there is no SYSTEM lane. An absent actor grants no
  // authority by itself, so activation without an identifiable person is
  // refused before anything else is considered.
  if (!actor || !actor.id) {
    add("NO_ACTOR", "Aucun administrateur identifié : une mise en service anonyme ou automatique est refusée.");
  } else {
    if (!actor.canProvision) {
      add("FORBIDDEN", "Cet administrateur ne détient pas l'autorisation d'administration des boîtes.");
    }
    if (m.tenantId !== actor.tenantId) {
      add("CROSS_TENANT", "Cette boîte appartient à un autre tenant.");
    }
  }

  // --- state --------------------------------------------------------------
  const state = canonicalState(m.provisioningStatus);
  if (state === "FAILED") {
    add("UNRESOLVED_FAILURE",
      `Un échec non résolu subsiste${m.provisioningNote ? ` : ${m.provisioningNote}` : ""}.`);
  } else if (state !== "VERIFIED" && state !== "DISABLED") {
    add("WRONG_STATE",
      `La mise en service part de « ${STATE_FR.VERIFIED} » ou « ${STATE_FR.DISABLED} », pas de « ${STATE_FR[state]} ».`);
  }

  // --- shape --------------------------------------------------------------
  const typeCoherent = m.mailboxType === "PERSONAL" ? Boolean(m.ownerUserId) : !m.ownerUserId;
  if (!typeCoherent) {
    add("TYPE_INCOMPATIBLE",
      "Type de boîte et titulaire incohérents : une boîte personnelle nomme son titulaire, une boîte partagée ou fonctionnelle n'en a pas.");
  }

  // --- evidence -----------------------------------------------------------
  if (m.ownership === "UNKNOWN") {
    add("OWNERSHIP_UNKNOWN", "Provenance non établie : ni gérée par la plateforme, ni confirmée comme boîte d'entreprise existante.");
  }
  if (!m.externalProvider && !m.externalMailboxId) {
    add("EXTERNAL_REFERENCE_MISSING", "Aucune référence externe enregistrée (fournisseur ou identifiant de boîte).");
  }
  if (!m.corporateIdentityConfirmedAt) {
    add("CORPORATE_IDENTITY_UNCONFIRMED", "L'existence de l'adresse dans la messagerie d'entreprise n'a pas été confirmée.");
  } else if (isStale(m.corporateIdentityConfirmedAt, now, policy.identityMaxAgeDays)) {
    add("EVIDENCE_STALE",
      `La confirmation d'identité dépasse la durée de validité définie (${policy.identityMaxAgeDays} jours).`);
  }

  // --- maker-checker ------------------------------------------------------
  // Two identifiable people: one records the evidence, another puts the mailbox
  // into service. Nothing new is invented to achieve it — both acts already
  // require `communication:mailbox:provision`, so it needs two holders of a
  // permission that already exists, which is an operator decision, not a
  // workflow.
  if (!m.corporateIdentityConfirmedBy) {
    add("NO_VERIFIER_RECORDED", "Aucun vérificateur identifié : la personne ayant confirmé l'identité n'est pas enregistrée.");
  } else if (actor?.id && actor.id === m.corporateIdentityConfirmedBy) {
    add("MAKER_CHECKER_SAME_ACTOR",
      "Séparation des tâches : la personne qui a enregistré la vérification ne peut pas mettre la boîte en service. Un second administrateur est requis.");
  }

  return { allowed: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// 6. Permitted actions — what the UI may offer
// ---------------------------------------------------------------------------

export type LifecycleAction =
  | "CONFIGURE"
  | "SUBMIT_VERIFICATION"
  | "RECORD_VERIFICATION"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "RETRY";

export const ACTION_FR: Record<LifecycleAction, string> = {
  CONFIGURE: "Configurer",
  SUBMIT_VERIFICATION: "Soumettre à vérification",
  RECORD_VERIFICATION: "Enregistrer le résultat",
  ACTIVATE: "Activer",
  DEACTIVATE: "Désactiver",
  RETRY: "Réessayer",
};

/**
 * The actions this mailbox may take next, in lifecycle order.
 *
 * ACTIVATE appears only when the guard would ALLOW it. A button that exists to
 * produce an error message is a button that teaches administrators the rules
 * are arbitrary — and it puts a copy of the activation rules in the component,
 * which is exactly what having one authority is meant to prevent.
 */
export function permittedActions(input: {
  actor: ActivationActor | null;
  mailbox: LifecycleFacts;
  now: string;
  policy?: EvidencePolicy;
}): LifecycleAction[] {
  const { actor, mailbox: m } = input;
  if (!actor || !actor.id || !actor.canProvision) return [];
  if (m.tenantId !== actor.tenantId) return [];

  const state = canonicalState(m.provisioningStatus);
  const out: LifecycleAction[] = [];

  switch (state) {
    case "RESERVED":
    case "CONFIGURATION_REQUIRED":
      out.push("CONFIGURE");
      break;
    case "CONFIGURED":
      out.push("CONFIGURE", "SUBMIT_VERIFICATION");
      break;
    case "PENDING_VERIFICATION":
      out.push("RECORD_VERIFICATION");
      break;
    case "VERIFIED":
      out.push("RECORD_VERIFICATION");
      if (activationGuard(input).allowed) out.push("ACTIVATE");
      break;
    case "ACTIVE":
      out.push("RECORD_VERIFICATION", "DEACTIVATE");
      break;
    case "FAILED":
      out.push("RETRY", "CONFIGURE");
      break;
    case "DISABLED":
      out.push("CONFIGURE");
      if (activationGuard(input).allowed) out.push("ACTIVATE");
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. The view a surface renders
// ---------------------------------------------------------------------------

/**
 * Everything the administration panel needs, DECIDED ON THE SERVER.
 *
 * The panel receives this and renders it. It evaluates no rule of its own —
 * partly because scattering activation rules across components is what this
 * phase exists to prevent, and partly because the guard takes `now`, and a
 * client component reading its own clock at render would disagree with the
 * server that will actually run the action.
 */
export type MailboxLifecycleView = {
  mailboxId: string;
  state: MailboxState;
  stateFr: string;
  meaningFr: string;
  legacyActive: boolean;
  actions: LifecycleAction[];
  blockers: ActivationBlocker[];
  checks: ReadinessCheck[];
  capability: CapabilityReadiness;
};

export function buildLifecycleView(input: {
  actor: ActivationActor | null;
  mailbox: LifecycleFacts;
  now: string;
  policy?: EvidencePolicy;
}): MailboxLifecycleView {
  const { mailbox: m, now } = input;
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const state = canonicalState(m.provisioningStatus);
  return {
    mailboxId: m.id,
    state,
    stateFr: STATE_FR[state],
    meaningFr: STATE_MEANING_FR[state],
    legacyActive: isLegacyActive(m),
    actions: permittedActions({ ...input, policy }),
    blockers: activationGuard({ ...input, policy }).blockers,
    checks: readinessChecks(m, input.actor?.tenantId ?? m.tenantId, now, policy),
    capability: capabilityReadiness(m, now, policy),
  };
}

/** Is this transition one the lifecycle admits at all? The guard decides
 *  whether a permitted transition may proceed; this decides whether it exists. */
export function canTransition(from: MailboxState, to: MailboxState): boolean {
  const allowed: Record<MailboxState, MailboxState[]> = {
    RESERVED: ["CONFIGURATION_REQUIRED", "CONFIGURED", "FAILED"],
    CONFIGURATION_REQUIRED: ["CONFIGURED", "FAILED"],
    CONFIGURED: ["PENDING_VERIFICATION", "CONFIGURED", "FAILED"],
    PENDING_VERIFICATION: ["VERIFIED", "FAILED"],
    VERIFIED: ["ACTIVE", "PENDING_VERIFICATION", "CONFIGURED", "FAILED"],
    ACTIVE: ["DISABLED", "PENDING_VERIFICATION"],
    FAILED: ["CONFIGURATION_REQUIRED", "CONFIGURED"],
    DISABLED: ["ACTIVE", "CONFIGURED"],
  };
  return (allowed[from] ?? []).includes(to);
}
