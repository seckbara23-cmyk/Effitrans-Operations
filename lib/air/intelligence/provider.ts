/**
 * Air Cargo — provider abstraction + readiness + status map (Phase 7.3A). PURE (no network).
 * Sibling of the shipping provider. Services talk only to the AirCargoEngine; milestone
 * transitions are validated LOCALLY. No live airline call — honest stubs only. No invented
 * URL, credential, status vocabulary, or env var.
 */
import { classifyAirMilestone, isAirMilestone, type AirMilestone, type AirApplyResult } from "./milestones";

export type AirProviderError = "not_configured" | "unsupported" | "unavailable" | "not_found" | "rate_limited" | "invalid_reference" | "timeout";
export type AirResult<T> = { ok: true; data: T } | { ok: false; error: AirProviderError };
export type ProviderHealth = { ok: boolean; configured: boolean; detail?: string };

export type AirProviderCapabilities = { awbLookup: boolean; milestoneTracking: boolean; flightPosition: boolean; eta: boolean; webhook: boolean; polling: boolean };
export type AirProviderShipment = { mawb: string | null; hawb: string | null; milestone: AirMilestone | null; flightNumber: string | null };
export type AirTrackingInput = { reference: string; type: "mawb" | "hawb" };
export type AirTrackingUpdate = { milestone?: AirMilestone | null; etaValue?: string | null };

export interface AirProvider {
  readonly code: string;
  readonly configured: boolean;
  capabilities(): AirProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
  findByAwb(reference: string): Promise<AirResult<AirProviderShipment>>;
  refreshTracking(input: AirTrackingInput): Promise<AirResult<AirTrackingUpdate>>;
}

const NO_CAPS: AirProviderCapabilities = { awbLookup: false, milestoneTracking: false, flightPosition: false, eta: false, webhook: false, polling: false };

export class ManualAirProvider implements AirProvider {
  readonly code = "manual";
  readonly configured = true;
  capabilities(): AirProviderCapabilities { return { ...NO_CAPS, milestoneTracking: true }; }
  async healthCheck(): Promise<ProviderHealth> { return { ok: true, configured: true, detail: "manual entry" }; }
  async findByAwb(): Promise<AirResult<AirProviderShipment>> { return { ok: false, error: "unsupported" }; }
  async refreshTracking(): Promise<AirResult<AirTrackingUpdate>> { return { ok: false, error: "not_configured" }; }
}

/** Honest airline STUB — advertises nothing, every op reports not_configured. No integration. */
export class AirlineProvider implements AirProvider {
  constructor(readonly code = "airline") {}
  readonly configured = false;
  capabilities(): AirProviderCapabilities { return { ...NO_CAPS }; }
  async healthCheck(): Promise<ProviderHealth> { return { ok: false, configured: false, detail: "no verified airline contract" }; }
  async findByAwb(): Promise<AirResult<AirProviderShipment>> { return { ok: false, error: "not_configured" }; }
  async refreshTracking(): Promise<AirResult<AirTrackingUpdate>> { return { ok: false, error: "not_configured" }; }
}

export const AIR_PROVIDERS = ["manual", "airline"] as const;
export type AirProviderCode = (typeof AIR_PROVIDERS)[number];

export function resolveAirProvider(code?: string | null): AirProvider {
  if (code === "airline") return new AirlineProvider();
  return new ManualAirProvider();
}

export class AirCargoEngine {
  constructor(private readonly provider: AirProvider) {}
  get providerCode(): string { return this.provider.code; }
  get providerConfigured(): boolean { return this.provider.configured; }
  capabilities(): AirProviderCapabilities { return this.provider.capabilities(); }
  applyMilestone(current: AirMilestone, next: AirMilestone): AirApplyResult { return classifyAirMilestone(current, next); }
  findByAwb(reference: string, type: "mawb" | "hawb"): Promise<AirResult<AirProviderShipment>> { return this.provider.findByAwb(reference); }
  async refresh(current: AirMilestone, input: AirTrackingInput): Promise<AirResult<AirTrackingUpdate> & { milestoneAccepted?: boolean }> {
    const res = await this.provider.refreshTracking(input);
    if (!res.ok) return res;
    const m = res.data.milestone;
    if (m == null) return { ...res, milestoneAccepted: false };
    if (!isAirMilestone(m)) return { ok: false, error: "unavailable" };
    return { ...res, milestoneAccepted: this.applyMilestone(current, m).ok };
  }
}

// -------------------------------------------------------- status map (allowlist) ----
export const AIRLINE_STATUS_MAP: Record<string, Record<string, { milestone: AirMilestone; note?: string }>> = Object.freeze({
  airline: Object.freeze({}), // EMPTY until an official airline status vocabulary is verified
});
export function normalizeRawStatus(raw: string): string { return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "_"); }
export function mapAirlineStatus(providerCode: string, raw: string): { confidence: "exact"; milestone: AirMilestone } | { confidence: "unmapped"; milestone: null; reason: "unknown_airline_status" } {
  const rule = (AIRLINE_STATUS_MAP[providerCode] ?? {})[normalizeRawStatus(raw)];
  if (rule) return { confidence: "exact", milestone: rule.milestone };
  if (providerCode === "manual" && isAirMilestone(normalizeRawStatus(raw))) return { confidence: "exact", milestone: normalizeRawStatus(raw) as AirMilestone };
  return { confidence: "unmapped", milestone: null, reason: "unknown_airline_status" };
}

// -------------------------------------------------------- readiness / config ----
export type ProviderConfigStatus = "configured" | "missing" | "invalid" | "unsupported";
export type AirProviderConfig = { providerCode: string; displayName: string; status: ProviderConfigStatus; live: boolean; requiredInputs: string[]; presentInputs: string[] };
export const AIR_PROVIDER_NAMES: Record<string, string> = { manual: "Saisie manuelle", airline: "Compagnie aérienne" };
export const AIRLINE_READINESS_CHECKLIST: string[] = [
  "Official airline / cargo API documentation", "Sandbox or approved environment", "Base URL", "Authentication method",
  "Supported identifier types (MAWB / HAWB)", "Request & response schemas", "Milestone / status vocabulary",
  "Rate limits", "Retry requirements", "Webhook or polling model", "Data-license & redistribution restrictions",
  "Customer-authorization requirements", "Production credential provisioning",
];
type EnvLike = Record<string, string | undefined>;
export function deriveAirProviderConfig(providerCode: string, _env: EnvLike): AirProviderConfig {
  const displayName = AIR_PROVIDER_NAMES[providerCode] ?? providerCode;
  if (providerCode === "manual") return { providerCode, displayName, status: "configured", live: true, requiredInputs: [], presentInputs: [] };
  if (providerCode === "airline") return { providerCode, displayName, status: "unsupported", live: false, requiredInputs: AIRLINE_READINESS_CHECKLIST, presentInputs: [] };
  return { providerCode, displayName, status: "unsupported", live: false, requiredInputs: [], presentInputs: [] };
}
export function resolveAirProviderConfig(providerCode: string): AirProviderConfig {
  return deriveAirProviderConfig(providerCode, process.env as EnvLike);
}
