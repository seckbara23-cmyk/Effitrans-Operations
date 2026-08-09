/**
 * EMP-5E — the French vocabulary of a mailbox. PURE, no I/O.
 *
 * Two fields that were one, and the whole phase turns on telling them apart in
 * the surface an administrator actually reads:
 *
 *   USAGE (`purpose`)                  — what the mailbox is FOR. A label.
 *                                        Free tenant vocabulary since EC-1.
 *                                        Drives NOTHING about who is proposed.
 *   ÉLIGIBILITÉ (`department_eligibility`) — which department's employees are
 *                                        PROPOSED for it automatically.
 *                                        Controlled, constrained, nullable.
 *
 * NO VOCABULARY IS INVENTED HERE. The purpose options are exactly the codes the
 * platform already uses — EC-1's `GENERAL` default, the `QUOTATION` value the
 * triage engine keys on, and the six the provisioning form has always offered —
 * each given the French label it lacked. Adding a new purpose code (billing,
 * claims, …) is a tenant vocabulary decision, not something a UI list should
 * settle on its own.
 */
import {
  DEPARTMENT_ELIGIBILITY_VALUES, type DepartmentEligibility,
} from "./eligibility";

// ---------------------------------------------------------------------------
// Usage de la boîte — `ec_mailbox.purpose`
// ---------------------------------------------------------------------------

/** Codes already in use somewhere in the platform. NOT an exhaustive domain:
 *  the column is free text by EC-1's design and holds whatever a tenant wrote. */
export const MAILBOX_PURPOSE_OPTIONS = [
  "GENERAL", "QUOTATION", "OPERATIONS", "TRANSIT",
  "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT",
] as const;

const PURPOSE_FR: Record<string, string> = {
  GENERAL: "Correspondance générale",
  QUOTATION: "Devis",
  OPERATIONS: "Opérations",
  TRANSIT: "Transit",
  CUSTOMS: "Douane",
  FINANCE: "Finance",
  COMMERCIAL: "Commercial",
  SUPPORT: "Support client",
};

/**
 * The French label for a purpose, falling back to the stored value.
 *
 * The fallback is not laziness. `purpose` is free vocabulary, so a tenant may
 * legitimately hold a value this map has never heard of — showing it verbatim
 * is honest, whereas mapping the unknown to "Autre" would hide what the row
 * actually says.
 */
export function purposeLabelFr(purpose: string | null | undefined): string {
  const v = (purpose ?? "").trim();
  if (!v) return "—";
  return PURPOSE_FR[v] ?? v;
}

// ---------------------------------------------------------------------------
// Département éligible — `ec_mailbox.department_eligibility`
// ---------------------------------------------------------------------------

const ELIGIBILITY_FR: Record<DepartmentEligibility, string> = {
  OPERATIONS: "Opérations",
  TRANSIT: "Transit",
  CUSTOMS: "Douane",
  FINANCE: "Finance",
  COMMERCIAL: "Commercial",
  SUPPORT: "Support",
};

/** NULL is a real, valid answer — and it says what it means rather than
 *  reading as a missing value. */
export const ELIGIBILITY_NONE_FR = "Aucun — attribution manuelle uniquement";

export function eligibilityLabelFr(value: string | null | undefined): string {
  if (!value) return ELIGIBILITY_NONE_FR;
  return ELIGIBILITY_FR[value as DepartmentEligibility] ?? value;
}

/** The picker's options, NULL first: the safe answer is the default answer. */
export const ELIGIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: ELIGIBILITY_NONE_FR },
  ...DEPARTMENT_ELIGIBILITY_VALUES.map((v) => ({ value: v, label: ELIGIBILITY_FR[v] })),
];

// ---------------------------------------------------------------------------
// Type de boîte — frozen meanings (EMP-5E §8)
// ---------------------------------------------------------------------------

export const MAILBOX_TYPE_FR: Record<string, string> = {
  PERSONAL: "Personnelle",
  SHARED: "Partagée",
  FUNCTIONAL: "Fonctionnelle",
};

/**
 * What each type MEANS on this platform.
 *
 * Deliberately platform semantics, not provider semantics: a department address
 * may well be an ordinary user mailbox at Microsoft 365 or LWS with delegated
 * access, and calling it "partagée" here says how Effitrans uses it, not how
 * the provider implements it.
 */
export const MAILBOX_TYPE_MEANING_FR: Record<string, string> = {
  PERSONAL:
    "Attribuée principalement à une personne physique. La délégation reste "
    + "exceptionnelle et explicite ; elle n'est jamais proposée à un département entier.",
  SHARED:
    "Destinée à plusieurs utilisateurs autorisés. Peut porter une éligibilité "
    + "départementale et sert un flux de travail collectif.",
  FUNCTIONAL:
    "Représente une fonction de l'entreprise plutôt qu'une personne ou un "
    + "département (info, support, devis). Attribution manuelle ou par éligibilité.",
};

/**
 * An alias is not a mailbox.
 *
 * It resolves to another mailbox or routing target and holds no members of its
 * own — `ec_mailbox_member.mailbox_id` references `ec_mailbox`, so an alias id
 * cannot carry membership by construction, not by convention.
 */
export const ALIAS_TYPE_FR: Record<string, string> = {
  ALIAS: "Alias — résout vers une autre boîte",
  DISTRIBUTION_LIST: "Liste de diffusion — se répartit sur plusieurs destinataires",
  FORWARD: "Renvoi — réexpédie vers une autre adresse",
};

// ---------------------------------------------------------------------------
// Ownership — EMP-5C
// ---------------------------------------------------------------------------

export const OWNERSHIP_FR: Record<string, string> = {
  PLATFORM_MANAGED: "Gérée par la plateforme",
  CORPORATE_EXISTING: "Existante dans la messagerie d'entreprise",
  UNKNOWN: "Provenance non établie",
};
