/**
 * Customs Intelligence — provider configuration resolver (Phase 7.1B).
 * ---------------------------------------------------------------------------
 * SERVER-ONLY intent: this module reads environment configuration and must never be
 * imported from a client component (enforced structurally by the test suite). It reports
 * a provider's readiness as a STATUS + a checklist of required inputs by NAME — it NEVER
 * returns, logs, or prints a secret value.
 *
 * GAINDE reality (7.1B): there is NO official GAINDE API contract wired. The project
 * integrates GAINDE by reference, not by API (BLK-1 is still open — no documented base
 * URL, auth method, schemas, status/error vocabulary, rate limits, or data-retention
 * rules). Per the phase rule "add an operator configuration surface only for verified
 * fields", we invent NO GAINDE endpoints or env vars. GAINDE is therefore reported as
 * `unsupported`, with the exact external inputs required to lift the block. A real adapter
 * (and the `missing`/`invalid` env states below) arrives in 7.1C once those are verified.
 *
 * The pure `deriveProviderConfig(providerCode, env)` takes an injected env so it is
 * unit-testable without touching process.env or any secret.
 */

export type ProviderConfigStatus = "configured" | "missing" | "invalid" | "unsupported";

export type ProviderConfig = {
  providerCode: string;
  status: ProviderConfigStatus;
  /** Whether the platform can talk to the provider right now. */
  live: boolean;
  /** The external inputs required before a live adapter can exist — NAMES only. */
  requiredInputs: string[];
  /** Which required inputs are currently present — NAMES only, never values. */
  presentInputs: string[];
};

/**
 * The formal GAINDE integration-readiness checklist — the exact external contract that
 * must be verified before any live GAINDE call may be implemented. This is the phase's
 * honest statement of what blocks live connectivity, not a set of env vars to fill in.
 */
export const GAINDE_READINESS_CHECKLIST: string[] = [
  "Official GAINDE API documentation",
  "Supported environment or sandbox",
  "Base URL",
  "Authentication method",
  "Credential provisioning",
  "Request / response schemas",
  "Status vocabulary",
  "Error vocabulary",
  "Rate limits",
  "Retry rules",
  "Webhook or polling model",
  "Data-retention restrictions",
  "Legal / contractual authorization",
];

type EnvLike = Record<string, string | undefined>;

/**
 * Derive a provider's configuration status from env. PURE (env injected).
 *  - manual   → always `configured` (no external system; nothing to provision).
 *  - GAINDE   → `unsupported` in 7.1B (no verified contract; readiness checklist returned).
 *  - unknown  → `unsupported`.
 * Never reads or returns a secret value.
 */
export function deriveProviderConfig(providerCode: string, _env: EnvLike): ProviderConfig {
  if (providerCode === "manual") {
    return { providerCode, status: "configured", live: true, requiredInputs: [], presentInputs: [] };
  }
  if (providerCode === "GAINDE") {
    // No official contract is wired. We do NOT probe invented env vars — doing so would
    // imply an adapter exists. Report the honest blocker + the required inputs.
    return {
      providerCode,
      status: "unsupported",
      live: false,
      requiredInputs: GAINDE_READINESS_CHECKLIST,
      presentInputs: [],
    };
  }
  return { providerCode, status: "unsupported", live: false, requiredInputs: [], presentInputs: [] };
}

/** Resolve a provider's configuration from the real environment (server-side callers). */
export function resolveProviderConfig(providerCode: string): ProviderConfig {
  return deriveProviderConfig(providerCode, process.env as EnvLike);
}
