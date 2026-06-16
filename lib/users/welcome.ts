/**
 * Staff welcome / onboarding email vars (Phase 1.19) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Builds the {{var}} bag for the `staff_welcome` template. Deliberately carries
 * NO password: onboarding uses a secure self-service set-password link
 * (Supabase recovery link) so a plaintext credential never travels by email.
 * Pure + unit-tested; the action layer supplies the live login URL + setup link.
 */
import type { TemplateVars } from "@/lib/comms/render";

export function staffWelcomeVars(input: {
  name: string | null;
  email: string;
  loginUrl: string;
  setupLink: string;
}): TemplateVars {
  return {
    // Fall back to the email's local part when no name was provided.
    name: input.name?.trim() || input.email.split("@")[0],
    email: input.email,
    loginUrl: input.loginUrl,
    setupLink: input.setupLink,
  };
}
