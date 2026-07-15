/**
 * Workspace switcher model (Phase 6.0H). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * UX-ONLY. Builds the list of workspaces the CURRENT session may switch between:
 * the user's ACTIVE tenant membership(s) + Platform Administration (only if they hold a
 * platform identity). It invents nothing — membership is an existing `app_user` row, and
 * platform access is an existing `platform_admin` row. It grants no access; the target
 * routes and RLS remain the sole authority.
 *
 * NOTE on cardinality: `app_user.id` is the PK (= auth.users.id), so one login has AT MOST
 * ONE tenant membership today. This builder is written for the general case (a list), so
 * it needs no change if the membership model ever grows — it simply renders however many
 * ACTIVE memberships the server reads.
 *
 * Visibility: an INACTIVE membership is hidden (not a workspace the user has). An ACTIVE
 * membership whose TENANT is suspended/archived/trial-expired is shown DISABLED with a
 * reason. `hasSwitch` is true only when there is more than one destination — a pure tenant
 * user (one tenant, no platform) gets no switch, exactly as required.
 */
import { tenantBlockReason, isLifecycleStatus, type TenantBlockReason } from "@/lib/platform/company-metadata";
import { primaryRoleLabel } from "@/lib/navigation/roles";

export type WorkspaceEntry = {
  kind: "tenant" | "platform";
  /** tenantId, or the literal "platform". */
  id: string;
  name: string;
  monogram: string;
  /** French role summary — never a raw role code. */
  roleSummary: string | null;
  disabled: boolean;
  disabledReason: string | null;
  /** Platform entry: a direct guarded href. Tenant entry: null (selection via the server action). */
  href: string | null;
};

export type WorkspaceMenu = {
  email: string;
  entries: WorkspaceEntry[];
  /** More than one destination → render the switch. */
  hasSwitch: boolean;
};

export type TenantMembershipInput = {
  tenantId: string;
  /** app_user.status */
  status: string;
  name: string;
  /** organization.lifecycle_status */
  lifecycleStatus: string;
  trialEndsAt: string | null;
  roleCodes: string[];
};

export type PlatformInput = { role: string } | null;

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "Super administrateur",
  PLATFORM_SUPPORT: "Support plateforme",
  PLATFORM_BILLING: "Facturation plateforme",
  PLATFORM_READ_ONLY: "Lecture seule",
};

const BLOCK_REASON_FR: Record<TenantBlockReason, string> = {
  SUSPENDED: "Suspendu",
  ARCHIVED: "Archivé",
  TRIAL_EXPIRED: "Essai expiré",
};

export function platformRoleLabel(role: string): string {
  return PLATFORM_ROLE_LABELS[role] ?? "Administrateur plateforme";
}

/** Two-letter monogram from a display name (fallback "—"). */
export function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return initials || "—";
}

/**
 * Build the switcher menu from resolved inputs. `now` is injected for deterministic
 * trial-expiry derivation. Pure and fully tested.
 */
export function buildWorkspaceMenu(args: {
  email: string;
  memberships: TenantMembershipInput[];
  platform: PlatformInput;
  now: number;
}): WorkspaceMenu {
  const entries: WorkspaceEntry[] = [];

  for (const m of args.memberships) {
    // Hidden: the user is deactivated in this tenant — not a workspace they have.
    if (m.status !== "active") continue;

    let disabled = false;
    let disabledReason: string | null = null;
    if (isLifecycleStatus(m.lifecycleStatus)) {
      const block = tenantBlockReason(m.lifecycleStatus, m.trialEndsAt, args.now);
      if (block) {
        disabled = true;
        disabledReason = BLOCK_REASON_FR[block];
      }
    }

    entries.push({
      kind: "tenant",
      id: m.tenantId,
      name: m.name,
      monogram: monogram(m.name),
      roleSummary: primaryRoleLabel(m.roleCodes),
      disabled,
      disabledReason,
      href: null, // selection goes through the server action (verified) — never a raw client link
    });
  }

  if (args.platform) {
    entries.push({
      kind: "platform",
      id: "platform",
      name: "Administration plateforme",
      monogram: "EP",
      roleSummary: platformRoleLabel(args.platform.role),
      disabled: false,
      disabledReason: null,
      href: "/platform",
    });
  }

  return { email: args.email, entries, hasSwitch: entries.length > 1 };
}
