/**
 * Derived tenant onboarding checklist (Phase 6.0E-2). PURE — no React, no I/O.
 * ---------------------------------------------------------------------------
 * A READ-DERIVED view of onboarding progress, computed entirely from facts already
 * persisted and already read for the Company Detail console (the safe CompanySummary
 * + the tenant's rollout row). It introduces NO second writable onboarding system and
 * NEVER mutates organization.onboarding_status — that column stays a descriptive,
 * provisioning-set field; this checklist derives real progress independently, so it
 * cannot drift or be gamed by a "mark complete" checkbox.
 *
 * Every item is backed by a concrete fact (a count, a date, a boolean the platform
 * already trusts). Nothing here fabricates completion. Items with no platform page that
 * resolves them (a tenant-side dossier) carry a null tab rather than a dead link.
 */
import type { CompanySummary } from "@/lib/platform/companies";

/** A console tab an item links to, or null when no platform page resolves it. */
export type OnboardingTab = "overview" | "users" | "branding" | "rollout" | null;

export type OnboardingItem = {
  key: string;
  label: string;
  complete: boolean;
  /** A short French statement of the evidence — why this is (in)complete. */
  evidence: string;
  /** The most relevant timestamp, when the fact carries one. */
  timestamp: string | null;
  /** Which console tab resolves/advances this item, or null. */
  tab: OnboardingTab;
};

export type OnboardingChecklist = {
  items: OnboardingItem[];
  completed: number;
  total: number;
  /** e.g. "5 sur 8 étapes terminées" — no false-precision percentage. */
  summary: string;
};

/**
 * Derive the checklist from the company summary + the tenant's rollout facts.
 *
 * `rollout.rowExists` — a tenant_process_rollout row was created for the tenant.
 * `rollout.live`      — the EFFECTIVE engine state (kill switch ANDed with the row),
 *                       passed in from the rollout overview, never recomputed here.
 */
export function deriveOnboardingChecklist(
  company: CompanySummary,
  rollout: { rowExists: boolean; live: boolean },
): OnboardingChecklist {
  const hasAdministrator = company.userCount > 0 && company.administratorEmail !== null;

  const items: OnboardingItem[] = [
    {
      key: "provisioned",
      label: "Organisation provisionnée",
      complete: true, // if we can read this company, its organization row exists.
      evidence: "Compte tenant créé.",
      timestamp: company.createdAt,
      tab: "overview",
    },
    {
      key: "administrator",
      label: "Premier administrateur créé",
      complete: hasAdministrator,
      evidence: hasAdministrator ? `Administrateur : ${company.administratorEmail}` : "Aucun administrateur système.",
      timestamp: null,
      tab: "users",
    },
    {
      key: "admin_activity",
      label: "Première connexion enregistrée",
      complete: company.lastTenantLoginAt !== null,
      evidence: company.lastTenantLoginAt ? "Un utilisateur s'est déjà connecté." : "Aucune connexion tenant à ce jour.",
      timestamp: company.lastTenantLoginAt,
      tab: "users",
    },
    {
      key: "branding",
      label: "Image de marque configurée",
      complete: company.brandingComplete,
      evidence: company.brandingComplete ? "Marque revue dans la console." : "Marque non encore configurée.",
      timestamp: null,
      tab: "branding",
    },
    {
      key: "rollout_row",
      label: "Déploiement du processus initialisé",
      complete: rollout.rowExists,
      evidence: rollout.rowExists ? "Ligne de déploiement présente." : "Aucune ligne de déploiement.",
      timestamp: null,
      tab: "rollout",
    },
    {
      key: "rollout_live",
      label: "Processus officiel activé",
      complete: rollout.live,
      evidence: rollout.live ? "Moteur de processus actif (effectif)." : "Moteur non activé pour ce tenant.",
      timestamp: null,
      tab: "rollout",
    },
    {
      key: "team",
      label: "Équipe opérationnelle ajoutée",
      complete: company.userCount > 1,
      evidence: company.userCount > 1 ? `${company.userCount} utilisateurs.` : "Seul l'administrateur est présent.",
      timestamp: null,
      tab: "users",
    },
    {
      key: "first_dossier",
      label: "Premier dossier créé",
      complete: company.activeDossierCount > 0,
      evidence: company.activeDossierCount > 0 ? `${company.activeDossierCount} dossier(s) actif(s).` : "Aucun dossier actif.",
      timestamp: null,
      // Dossiers live in the tenant app, which a platform admin cannot open — no link.
      tab: null,
    },
  ];

  const completed = items.filter((i) => i.complete).length;
  const total = items.length;
  return { items, completed, total, summary: `${completed} sur ${total} étapes terminées` };
}
