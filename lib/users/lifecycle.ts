/**
 * Staff user lifecycle (Phase 8.1A). PURE — client + server safe, unit-tested.
 * ---------------------------------------------------------------------------
 * THE single definition of the staff status vocabulary and its legal transitions. Everything
 * else (actions, directory reads, UI, historical rendering) consumes this module — no second
 * lifecycle table, no scattered status strings.
 *
 *   invited/active ⇄ inactive   suspend / reactivate (temporary — admin:users:manage)
 *   active|inactive → archived  permanent departure (SYSTEM_ADMIN's admin:users:manage)
 *   archived → active           restore (same gate; the ONLY exit from archived)
 *
 * ARCHIVE PRESERVES EVERYTHING: no row is deleted, no FK is touched, attribution is permanent.
 * There is deliberately NO delete transition for operational users — compliance-first: a user
 * who touched dossiers, customs, documents, invoices, audits or AI activity must remain
 * historically attributable forever.
 */

export const STAFF_STATUSES = ["active", "inactive", "archived"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export function isStaffStatus(s: string): s is StaffStatus {
  return (STAFF_STATUSES as readonly string[]).includes(s);
}

/** Normalize a raw DB value defensively (unknown → treated as inactive, never as active). */
export function toStaffStatus(s: string): StaffStatus {
  return isStaffStatus(s) ? s : "inactive";
}

/** The legal transitions. Anything not listed is refused (incl. archived → inactive). */
const TRANSITIONS: Record<StaffStatus, readonly StaffStatus[]> = {
  active: ["inactive", "archived"],
  inactive: ["active", "archived"],
  archived: ["active"], // restore only — an archived user re-enters as ACTIVE or not at all
};

export function canTransition(from: StaffStatus, to: StaffStatus): boolean {
  return from !== to && TRANSITIONS[from].includes(to);
}

/** French label for a status (single source for badges + historical suffix). */
export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  active: "Actif",
  inactive: "Suspendu",
  archived: "Archivé",
};

/**
 * Display name for HISTORICAL references to a staff user. Attribution is never dropped:
 * an archived user renders as "Aminata Mbaye (Archivé)" — never "Unknown user", never blank.
 * Active (and temporarily suspended) users render unchanged.
 */
export function staffDisplayName(nameOrEmail: string | null, status: string | null | undefined): string {
  const base = (nameOrEmail ?? "").trim() || "—";
  return status === "archived" ? `${base} (Archivé)` : base;
}
