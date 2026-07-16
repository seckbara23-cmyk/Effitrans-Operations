/**
 * Shipping Line Platform — provider abstraction (Phase 7.2A). PURE (no network I/O).
 * ---------------------------------------------------------------------------
 * Application services talk ONLY to the ShippingEngine; the engine delegates external
 * operations to a ShippingProvider. Carriers (Maersk/MSC/…) and AIS plug in by implementing
 * the interface — no service or UI change. 7.2A ships the abstraction + a Manual provider
 * (the current reality) + honest carrier STUBS + an AIS boundary. No live call is made,
 * because no official contract is verified (docs/shipping/shipping-provider-readiness.md).
 * Milestone transitions are validated LOCALLY by the shared milestone model — a provider
 * response never drives canonical state on its own.
 */
import { classifyMilestone, isShippingMilestone, type ShippingMilestone, type MilestoneApplyResult } from "./milestones";
import type { TrackingEventInput } from "./events";
import type { VesselPosition } from "./position";

export type ShippingProviderError =
  | "not_configured" | "unsupported" | "unavailable" | "not_found" | "rate_limited" | "invalid_reference" | "timeout";

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ShippingProviderError };
export type ProviderHealth = { ok: boolean; configured: boolean; detail?: string };

export type ShippingProviderCapabilities = {
  bookingLookup: boolean;
  blLookup: boolean;
  containerLookup: boolean;
  milestoneTracking: boolean;
  vesselIdentity: boolean;
  eta: boolean;
  webhook: boolean;
  polling: boolean;
};

export type ProviderShipment = {
  bookingReference: string | null;
  billOfLading: string | null;
  carrierCode: string | null;
  milestone: ShippingMilestone | null;
  containers: string[];
};

export type ProviderTrackingInput = { reference: string; type: "booking" | "bl" | "container" };
export type ProviderTrackingUpdate = { events: TrackingEventInput[]; milestone?: ShippingMilestone | null; etaValue?: string | null };

export interface ShippingProvider {
  readonly code: string;
  readonly configured: boolean;
  capabilities(): ShippingProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
  findByBooking(reference: string): Promise<ProviderResult<ProviderShipment>>;
  findByBillOfLading(reference: string): Promise<ProviderResult<ProviderShipment>>;
  findByContainer(reference: string): Promise<ProviderResult<ProviderShipment>>;
  refreshTracking(input: ProviderTrackingInput): Promise<ProviderResult<ProviderTrackingUpdate>>;
}

const NO_CAPS: ShippingProviderCapabilities = {
  bookingLookup: false, blLookup: false, containerLookup: false, milestoneTracking: false,
  vesselIdentity: false, eta: false, webhook: false, polling: false,
};

/** The current reality: operators enter milestones by hand. "configured" (it works), but it
 *  has no external lookup/poll — those are unsupported, never faked. */
export class ManualShippingProvider implements ShippingProvider {
  readonly code = "manual";
  readonly configured = true;
  capabilities(): ShippingProviderCapabilities {
    return { ...NO_CAPS, milestoneTracking: true }; // manual milestone entry only
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true, configured: true, detail: "manual entry" };
  }
  async findByBooking(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "unsupported" }; }
  async findByBillOfLading(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "unsupported" }; }
  async findByContainer(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "unsupported" }; }
  async refreshTracking(): Promise<ProviderResult<ProviderTrackingUpdate>> { return { ok: false, error: "not_configured" }; }
}

/** An honest carrier STUB — advertises no capability, every op reports not_configured. It
 *  exists so services + tests target the real interface, NOT to imply an integration. */
export class CarrierStubProvider implements ShippingProvider {
  constructor(readonly code: string) {}
  readonly configured = false;
  capabilities(): ShippingProviderCapabilities { return { ...NO_CAPS }; }
  async healthCheck(): Promise<ProviderHealth> { return { ok: false, configured: false, detail: "no verified contract" }; }
  async findByBooking(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "not_configured" }; }
  async findByBillOfLading(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "not_configured" }; }
  async findByContainer(): Promise<ProviderResult<ProviderShipment>> { return { ok: false, error: "not_configured" }; }
  async refreshTracking(): Promise<ProviderResult<ProviderTrackingUpdate>> { return { ok: false, error: "not_configured" }; }
}

/** Provider codes. `manual` is real; the carriers are stubs (unsupported) until verified. */
export const SHIPPING_PROVIDERS = ["manual", "maersk", "msc", "cma-cgm", "hapag-lloyd", "cosco", "one", "evergreen", "aggregator"] as const;
export type ShippingProviderCode = (typeof SHIPPING_PROVIDERS)[number];

export const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  manual: "Saisie manuelle", maersk: "Maersk", msc: "MSC", "cma-cgm": "CMA CGM",
  "hapag-lloyd": "Hapag-Lloyd", cosco: "COSCO", one: "Ocean Network Express",
  evergreen: "Evergreen", aggregator: "Agrégateur de suivi",
};

export function resolveShippingProvider(code?: string | null): ShippingProvider {
  if (!code || code === "manual") return new ManualShippingProvider();
  if ((SHIPPING_PROVIDERS as readonly string[]).includes(code)) return new CarrierStubProvider(code);
  return new ManualShippingProvider();
}

// --------------------------------------------------------------------- AIS boundary ----

/** AIS is a SEPARATE data source (its own licensing). Distinct interface. */
export interface VesselPositionProvider {
  readonly code: string;
  readonly configured: boolean;
  healthCheck(): Promise<ProviderHealth>;
  getPositionByImo(imo: string): Promise<ProviderResult<VesselPosition>>;
  getPositionByMmsi(mmsi: string): Promise<ProviderResult<VesselPosition>>;
}

/** AIS stub — unconfigured; no position may be sourced (redistribution rights unverified). */
export class AisStubProvider implements VesselPositionProvider {
  readonly code = "ais-generic";
  readonly configured = false;
  async healthCheck(): Promise<ProviderHealth> { return { ok: false, configured: false, detail: "no AIS license/contract" }; }
  async getPositionByImo(): Promise<ProviderResult<VesselPosition>> { return { ok: false, error: "not_configured" }; }
  async getPositionByMmsi(): Promise<ProviderResult<VesselPosition>> { return { ok: false, error: "not_configured" }; }
}

// ------------------------------------------------------------------- ShippingEngine ----

/**
 * The facade every service uses — never a provider directly. It validates milestone
 * transitions LOCALLY (the shared model, the platform's source of truth) and delegates
 * external lookups/refresh to the bound provider. No milestone is applied from a provider
 * response without local validation.
 */
export class ShippingEngine {
  constructor(private readonly provider: ShippingProvider) {}

  get providerCode(): string { return this.provider.code; }
  get providerConfigured(): boolean { return this.provider.configured; }
  capabilities(): ShippingProviderCapabilities { return this.provider.capabilities(); }
  healthCheck(): Promise<ProviderHealth> { return this.provider.healthCheck(); }

  /** Validate applying a milestone locally (advance / regress / exception / … or invalid). */
  applyMilestone(current: ShippingMilestone, next: ShippingMilestone): MilestoneApplyResult {
    return classifyMilestone(current, next);
  }

  find(input: ProviderTrackingInput): Promise<ProviderResult<ProviderShipment>> {
    if (input.type === "booking") return this.provider.findByBooking(input.reference);
    if (input.type === "bl") return this.provider.findByBillOfLading(input.reference);
    return this.provider.findByContainer(input.reference);
  }

  /** Refresh tracking, then LOCALLY validate any implied milestone before the caller trusts it. */
  async refresh(current: ShippingMilestone, input: ProviderTrackingInput): Promise<ProviderResult<ProviderTrackingUpdate> & { milestoneAccepted?: boolean }> {
    const res = await this.provider.refreshTracking(input);
    if (!res.ok) return res;
    const m = res.data.milestone;
    if (m == null) return { ...res, milestoneAccepted: false };
    if (!isShippingMilestone(m)) return { ok: false, error: "unavailable" };
    return { ...res, milestoneAccepted: this.applyMilestone(current, m).ok };
  }
}
