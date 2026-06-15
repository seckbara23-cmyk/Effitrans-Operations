/**
 * Payment-provider env configuration (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Secrets are read here and NEVER prefixed NEXT_PUBLIC_ (the boundary grep gate
 * keeps them out of the client bundle). A missing secret degrades that provider
 * to "not configured" — the app never crashes, the feature is just unavailable
 * (same pattern as the Supabase-not-configured notices + the 1.14 comms stub).
 */
import "server-only";
import { PROVIDERS, type ProviderName, isProviderName } from "../payment-intent";

/** Master feature flag. Off by default — online payments are dark until approved. */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "true";
}

/** Providers the platform is allowed to use (default: MOCK only, for dev/test). */
export function enabledProviders(): ProviderName[] {
  const raw = (process.env.PAYMENTS_PROVIDERS ?? "MOCK")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is ProviderName => isProviderName(s));
  return PROVIDERS.filter((p) => raw.includes(p));
}

export function intentTtlMinutes(): number {
  const n = Number(process.env.PAYMENTS_INTENT_TTL_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function mockWebhookSecret(): string | null {
  return process.env.PAYMENTS_MOCK_WEBHOOK_SECRET?.trim() || null;
}

export function waveSecrets(): { apiKey: string | null; webhookSecret: string | null } {
  return {
    apiKey: process.env.WAVE_API_KEY?.trim() || null,
    webhookSecret: process.env.WAVE_WEBHOOK_SECRET?.trim() || null,
  };
}

export function orangeMoneySecrets(): {
  clientId: string | null;
  clientSecret: string | null;
  webhookSecret: string | null;
} {
  return {
    clientId: process.env.ORANGE_MONEY_CLIENT_ID?.trim() || null,
    clientSecret: process.env.ORANGE_MONEY_CLIENT_SECRET?.trim() || null,
    webhookSecret: process.env.ORANGE_MONEY_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Replay-skew window for webhook timestamps (minutes). */
export function webhookSkewMinutes(): number {
  const n = Number(process.env.PAYMENTS_WEBHOOK_SKEW_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/**
 * Is a provider usable right now? MOCK needs its dev secret; Wave/Orange Money
 * need their credentials (absent in 1.15B → they stay not configured, by design).
 */
export function isProviderConfigured(name: ProviderName): boolean {
  if (!enabledProviders().includes(name)) return false;
  if (name === "MOCK") return mockWebhookSecret() != null;
  if (name === "WAVE") {
    const { apiKey, webhookSecret } = waveSecrets();
    return apiKey != null && webhookSecret != null;
  }
  if (name === "ORANGE_MONEY") {
    const { clientId, clientSecret, webhookSecret } = orangeMoneySecrets();
    return clientId != null && clientSecret != null && webhookSecret != null;
  }
  return false;
}

/** Providers a tenant can actually offer = enabled ∧ configured. */
export function usableProviders(): ProviderName[] {
  return enabledProviders().filter(isProviderConfigured);
}
