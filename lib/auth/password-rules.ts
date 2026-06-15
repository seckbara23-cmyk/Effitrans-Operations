/**
 * New-password validation — PURE (Phase 1.16B). No I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * Shared by the staff + portal update-password pages so the "too short" /
 * "mismatch" rules are one tested source of truth instead of inline UI logic.
 * Supabase enforces its own minimum server-side; this is the client-side guard.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordRuleError = "tooShort" | "mismatch";

/** Returns the first failing rule, or null when the new password is acceptable. */
export function validateNewPassword(
  password: string,
  confirm: string,
  minLength: number = MIN_PASSWORD_LENGTH,
): PasswordRuleError | null {
  if (password.length < minLength) return "tooShort";
  if (password !== confirm) return "mismatch";
  return null;
}
