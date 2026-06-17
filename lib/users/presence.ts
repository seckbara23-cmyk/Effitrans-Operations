/**
 * User presence classification (Phase 2.1A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Derives a simple online/recently-active/offline/never state from login +
 * last-seen metadata. NO realtime, NO page tracking — operational admin metadata
 * only. `now` is injected so it is fully unit-testable.
 */
export type Presence = "online" | "recently_active" | "offline" | "never";

export const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export type PresenceInput = {
  lastSeenAt: string | null | undefined;
  lastLoginAt: string | null | undefined;
  loginCount: number;
};

export function classifyPresence(input: PresenceInput, now: Date): Presence {
  const everLoggedIn = (input.loginCount ?? 0) > 0 || Boolean(input.lastLoginAt);
  if (!everLoggedIn) return "never";
  if (!input.lastSeenAt) return "offline";
  const seen = new Date(input.lastSeenAt).getTime();
  if (Number.isNaN(seen)) return "offline";
  const delta = now.getTime() - seen;
  if (delta < 0) return "online"; // clock skew: treat a future timestamp as just-seen
  if (delta <= ONLINE_WINDOW_MS) return "online";
  if (delta <= ACTIVE_WINDOW_MS) return "recently_active";
  return "offline";
}

/** Login methods recorded across the staff + portal flows. */
export type LoginMethod = "password" | "google" | "recovery" | "portal_password" | "portal_google";

const METHOD_LABELS: Record<string, string> = {
  password: "Mot de passe",
  google: "Google",
  recovery: "Réinitialisation",
  portal_password: "Portail (mot de passe)",
  portal_google: "Portail (Google)",
};

export function loginMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? method;
}
