/**
 * Shipping Line Platform — provider configuration / readiness (Phase 7.2A).
 * ---------------------------------------------------------------------------
 * SERVER-ONLY intent (never import from a client component — enforced by tests). Reports a
 * provider's readiness as a STATUS + a checklist of required inputs by NAME; NEVER returns,
 * logs, or prints a secret value. No carrier/AIS endpoint or env var is invented: with no
 * verified contract, carriers/AIS are `unsupported` and the readiness checklist states
 * exactly what must be obtained. Pure `derive*` takes an injected env for testability.
 */
export type ProviderConfigStatus = "configured" | "missing" | "invalid" | "unsupported";

export type ShippingProviderConfig = {
  providerCode: string;
  displayName: string;
  status: ProviderConfigStatus;
  live: boolean;
  requiredInputs: string[];
  presentInputs: string[];
};

import { CARRIER_DISPLAY_NAMES } from "./provider";

/** What must be verified before ANY carrier adapter may be written. Names only. */
export const CARRIER_READINESS_CHECKLIST: string[] = [
  "Official API documentation",
  "Sandbox or approved environment",
  "Base URL",
  "Authentication method",
  "Supported identifier types (booking / master BL / house BL / container)",
  "Request & response schemas",
  "Event / status vocabulary",
  "Rate limits",
  "Retry requirements",
  "Webhook or polling model (and signature scheme if webhook)",
  "Data-license restrictions",
  "Storage & redistribution restrictions",
  "Customer-authorization requirements",
  "Production credential provisioning",
];

/** AIS has its OWN checklist — redistribution licensing is the critical extra item. */
export const AIS_READINESS_CHECKLIST: string[] = [
  "Official AIS provider API documentation",
  "Sandbox or approved environment",
  "Base URL & authentication",
  "Position message schema (lat/lon/SOG/COG/heading/nav-status)",
  "Identifier support (IMO and/or MMSI)",
  "Rate limits & polling/stream model",
  "Redistribution & storage license (may positions be stored / shown to customers)",
  "Freshness / latency guarantees",
  "Production credentials",
];

type EnvLike = Record<string, string | undefined>;

/**
 * Derive a carrier provider's config. PURE (env injected).
 *  - manual  → configured (nothing to provision).
 *  - carrier → unsupported in 7.2A (no verified contract; readiness checklist returned).
 *  - unknown → unsupported.
 * Never probes invented env vars (that would imply an adapter exists).
 */
export function deriveShippingProviderConfig(providerCode: string, _env: EnvLike): ShippingProviderConfig {
  const displayName = CARRIER_DISPLAY_NAMES[providerCode] ?? providerCode;
  if (providerCode === "manual") {
    return { providerCode, displayName, status: "configured", live: true, requiredInputs: [], presentInputs: [] };
  }
  if (providerCode in CARRIER_DISPLAY_NAMES) {
    return { providerCode, displayName, status: "unsupported", live: false, requiredInputs: CARRIER_READINESS_CHECKLIST, presentInputs: [] };
  }
  return { providerCode, displayName, status: "unsupported", live: false, requiredInputs: [], presentInputs: [] };
}

export function resolveShippingProviderConfig(providerCode: string): ShippingProviderConfig {
  return deriveShippingProviderConfig(providerCode, process.env as EnvLike);
}

/** Derive the AIS provider config. Unsupported in 7.2A (no license/contract). PURE. */
export function deriveAisConfig(_env: EnvLike): ShippingProviderConfig {
  return {
    providerCode: "ais-generic",
    displayName: "AIS (positions navires)",
    status: "unsupported",
    live: false,
    requiredInputs: AIS_READINESS_CHECKLIST,
    presentInputs: [],
  };
}

export function resolveAisConfig(): ShippingProviderConfig {
  return deriveAisConfig(process.env as EnvLike);
}
