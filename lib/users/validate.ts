/**
 * Pure validation for user-management inputs (Task 6a). No imports — testable.
 */
export type CreateUserInput = {
  email: string;
  name?: string | null;
  password: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns an error message, or null if the input is valid. */
export function validateCreateUser(input: CreateUserInput): string | null {
  const email = (input.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) return "invalid_email";
  // Minimum length only — Supabase enforces its own password policy server-side.
  if (!input.password || input.password.length < 8) return "weak_password";
  return null;
}
