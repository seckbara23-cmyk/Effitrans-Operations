/**
 * Pure permission-check helpers (AUTHZ-2). No imports — unit-testable.
 * ---------------------------------------------------------------------------
 * Extracted from lib/rbac/permissions.ts so the deny-by-default checks can be
 * tested without importing the server-coupled resolution path. Behaviour
 * unchanged. Deny-by-default: anything not present is denied.
 */

/** True if `permissions` contains `code`. */
export function hasPermission(permissions: string[], code: string): boolean {
  return permissions.includes(code);
}

/** True if `permissions` contains every `codes` entry. */
export function hasAllPermissions(permissions: string[], codes: string[]): boolean {
  return codes.every((c) => permissions.includes(c));
}

/** True if `permissions` contains at least one `codes` entry. */
export function hasAnyPermission(permissions: string[], codes: string[]): boolean {
  return codes.some((c) => permissions.includes(c));
}
