/**
 * Provisioning wizard logic (Phase 6.0B). PURE — no React, no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * The seven-step wizard's brain lives here so it can be tested in node (this repo
 * has no jsdom): the draft shape, the reducer, the draft→ProvisionTenantInput
 * builder, per-step validation, the role derivation, and the mapping from a
 * ProvisionOutcome to what the UI should show. components/platform/
 * provisioning-wizard.tsx is a thin React shell over this.
 *
 * IT COLLECTS ONLY WHAT THE 6.0A CONTRACT SUPPORTS. ProvisionTenantInput has no
 * branding object and no administrator title, so this wizard has neither. Branding
 * is seeded by provision_tenant() from the company's own fields (trade name →
 * display name, email/phone → support contact); Step 3 confirms those rather than
 * inventing an upload flow that the engine could not consume.
 *
 * IT NEVER GENERATES THE IDEMPOTENCY KEY. That is a one-per-wizard-run value the
 * React shell mints once (crypto.randomUUID) and threads in at submit, so this
 * module stays deterministic — and so a rerender/refresh/double-click reuses the
 * SAME key and the engine's idempotency (6.0A) turns a duplicate submit into
 * already_exists rather than a second tenant.
 */
import {
  validateSlug,
  validateProvisionInput,
} from "./validate";
import { selectTenantRoleTemplates, type BusinessProfileKey } from "@/lib/platform/role-templates";
import { defaultModulesForPlan } from "@/lib/platform/entitlements";
import type { TenantPlanKey } from "@/lib/platform/entitlements";
import type { ProvisionTenantInput } from "./contract";
import type { ProvisionErrorCode } from "./errors";

// --------------------------------------------------------------- the steps ----

export const WIZARD_STEPS = [
  { key: "identity", label: "Identité de l'entreprise" },
  { key: "profile", label: "Profil métier" },
  { key: "branding", label: "Image de marque" },
  { key: "modules", label: "Modules et déploiement" },
  { key: "roles", label: "Rôles" },
  { key: "administrator", label: "Premier administrateur" },
  { key: "review", label: "Vérification et provisionnement" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];
export const STEP_COUNT = WIZARD_STEPS.length;

export function stepIndex(key: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((s) => s.key === key);
}

// --------------------------------------------------------------- the draft ----

const BUSINESS_PROFILE_KEYS: BusinessProfileKey[] = [
  "customsBroker",
  "freightForwarder",
  "roadTransport",
  "seaFreight",
  "airFreight",
  "warehousing",
  "importOperations",
  "exportOperations",
];

/** Human labels for the profile toggles. Registry keys never reach a screen. */
export const BUSINESS_PROFILE_LABELS: Record<BusinessProfileKey, string> = {
  customsBroker: "Commissionnaire en douane",
  freightForwarder: "Transitaire",
  roadTransport: "Transport routier",
  seaFreight: "Fret maritime",
  airFreight: "Fret aérien",
  warehousing: "Entreposage",
  importOperations: "Opérations import",
  exportOperations: "Opérations export",
};

export const PLAN_LABELS: Record<TenantPlanKey, string> = {
  STARTER: "Starter",
  PROFESSIONAL: "Professional",
  ENTERPRISE: "Enterprise",
};

/** The whole client-held draft. A flat, editable view of the contract fields. */
export type WizardDraft = {
  // Step 1 — identity
  legalName: string;
  tradeName: string;
  slug: string;
  country: string;
  language: string;
  timezone: string;
  currency: string;
  // Step 2 — profile
  businessProfile: Record<BusinessProfileKey, boolean>;
  companyEmail: string;
  companyPhone: string;
  ninea: string;
  rccm: string;
  // Step 4 — plan (drives default modules; rollout stays OFF regardless)
  plan: TenantPlanKey;
  // Step 6 — administrator
  adminFullName: string;
  adminEmail: string;
  adminPhone: string;
};

export function emptyDraft(): WizardDraft {
  return {
    legalName: "",
    tradeName: "",
    slug: "",
    country: "SN",
    language: "fr",
    timezone: "Africa/Dakar",
    currency: "XOF",
    businessProfile: Object.fromEntries(
      BUSINESS_PROFILE_KEYS.map((k) => [k, false]),
    ) as Record<BusinessProfileKey, boolean>,
    companyEmail: "",
    companyPhone: "",
    ninea: "",
    rccm: "",
    plan: "PROFESSIONAL",
    adminFullName: "",
    adminEmail: "",
    adminPhone: "",
  };
}

// --------------------------------------------------------------- reducer ----

export type WizardAction =
  | { type: "set"; field: keyof WizardDraft; value: string }
  | { type: "toggleProfile"; key: BusinessProfileKey }
  | { type: "setPlan"; plan: TenantPlanKey }
  | { type: "reset" };

export function draftReducer(draft: WizardDraft, action: WizardAction): WizardDraft {
  switch (action.type) {
    case "set":
      return { ...draft, [action.field]: action.value };
    case "toggleProfile":
      return {
        ...draft,
        businessProfile: {
          ...draft.businessProfile,
          [action.key]: !draft.businessProfile[action.key],
        },
      };
    case "setPlan":
      return { ...draft, plan: action.plan };
    case "reset":
      return emptyDraft();
    default:
      return draft;
  }
}

// --------------------------------------------------------- derived views ----

/**
 * The roles that will be provisioned for the current draft. Purely a function of
 * the business profile — the SAME selector the engine uses, so what Step 5 shows is
 * exactly what provision_tenant() will create. SYSTEM_ADMIN is always in it.
 */
export function rolesForDraft(draft: WizardDraft) {
  return selectTenantRoleTemplates(draft.businessProfile).map((t) => ({
    key: t.key,
    labelFr: t.labelFr,
    permissionCount: t.permissions.length,
    required: t.requiredForEveryTenant,
  }));
}

/** The plan's default modules, for the Step 4 summary. Read-only; engine recomputes. */
export function modulesForDraft(draft: WizardDraft): string[] {
  return [...defaultModulesForPlan(draft.plan)];
}

/**
 * Build the exact ProvisionTenantInput the engine expects. The idempotency key is
 * supplied by the caller (the React shell holds a stable one for the whole run).
 * `modules` is left empty: the engine resolves plan defaults, so we never second-
 * guess it here.
 */
export function draftToInput(draft: WizardDraft, idempotencyKey: string): ProvisionTenantInput {
  const trimmed = (s: string) => s.trim();
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    company: {
      legalName: trimmed(draft.legalName),
      tradeName: opt(draft.tradeName),
      slug: trimmed(draft.slug).toLowerCase(),
      country: trimmed(draft.country),
      currency: trimmed(draft.currency).toUpperCase(),
      timezone: trimmed(draft.timezone),
      language: trimmed(draft.language),
      email: opt(draft.companyEmail),
      phone: opt(draft.companyPhone),
      ninea: opt(draft.ninea),
      rccm: opt(draft.rccm),
    },
    administrator: {
      fullName: trimmed(draft.adminFullName),
      email: trimmed(draft.adminEmail).toLowerCase(),
      phone: opt(draft.adminPhone),
    },
    businessProfile: draft.businessProfile,
    modules: {},
    plan: draft.plan,
    idempotencyKey,
  };
}

// --------------------------------------------------------- validation ----

/**
 * Per-step validation for gating Next. UX only — the authoritative check is
 * validateProvisionInput at submit, and the engine re-validates server-side.
 * Reuses the shared slug rules; never re-implements them.
 */
export function validateStep(draft: WizardDraft, step: WizardStepKey): string[] {
  const errors: string[] = [];
  switch (step) {
    case "identity":
      if (!draft.legalName.trim()) errors.push("La raison sociale est requise.");
      errors.push(...validateSlug(draft.slug.trim().toLowerCase()).errors);
      if (!draft.country.trim()) errors.push("Le pays est requis.");
      if (!draft.language.trim()) errors.push("La langue est requise.");
      if (!draft.timezone.trim()) errors.push("Le fuseau horaire est requis.");
      break;
    case "administrator":
      if (!draft.adminFullName.trim()) errors.push("Le nom de l'administrateur est requis.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.adminEmail.trim())) {
        errors.push("Une adresse e-mail d'administrateur valide est requise.");
      }
      break;
    default:
      break; // profile / branding / modules / roles have no hard requirements
  }
  return errors;
}

/** The whole draft is valid to submit. Delegates to the 4.0B validator. */
export function draftReadyToProvision(draft: WizardDraft, idempotencyKey: string): boolean {
  return validateProvisionInput(draftToInput(draft, idempotencyKey)).ok;
}

// ----------------------------------------------------- outcome → view ----

/**
 * The friendly, platform-admin-facing message for each engine error. NEVER exposes
 * SQL, RPC internals, the service role, stack traces or secrets — just the closed
 * vocabulary, said plainly.
 */
export const ERROR_MESSAGES: Record<ProvisionErrorCode, string> = {
  invalid_input: "Certaines informations sont incomplètes ou invalides. Vérifiez les étapes précédentes.",
  duplicate_slug: "Cet identifiant (slug) est déjà utilisé par une autre entreprise. Choisissez-en un autre.",
  admin_email_conflict:
    "Cette adresse e-mail d'administrateur appartient déjà à une autre entreprise. Utilisez une autre adresse.",
  auth_user_creation_failed:
    "La création du compte administrateur a échoué. Réessayez ; vos informations sont conservées.",
  relational_provisioning_failed:
    "Le provisionnement a échoué et a été annulé — aucune entreprise partielle n'a été créée. Réessayez.",
  compensation_failed:
    "Le provisionnement a échoué et un nettoyage n'a pas pu se terminer. Réessayez : la même clé réutilisera le compte en attente.",
  invitation_send_failed:
    "L'entreprise a été créée, mais l'invitation n'a pas pu être envoyée. Récupérez le lien d'installation ci-dessous.",
  already_provisioned: "Cette entreprise a déjà été provisionnée.",
  unauthorized: "Vous n'êtes pas autorisé à provisionner une entreprise.",
};

/**
 * The step to return to for a given error. duplicate_slug sends the admin back to
 * Identity with the slug highlighted; admin_email_conflict to the Administrator
 * step. Everything else keeps them on Review with the draft intact.
 */
export function returnStepForError(code: ProvisionErrorCode): WizardStepKey {
  if (code === "duplicate_slug") return "identity";
  if (code === "admin_email_conflict") return "administrator";
  return "review";
}
