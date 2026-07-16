/**
 * Customs Intelligence — provider abstraction (Phase 7.1A). PURE (no external I/O yet).
 * ---------------------------------------------------------------------------
 * Platform services interact ONLY with the CustomsEngine; the engine delegates external
 * operations to a CustomsProvider. GAINDE / ORBUS / others plug in by implementing the
 * interface — no service code changes. 7.1A ships the abstraction + a Manual provider (the
 * current reality: customs tracked by hand) + a GAINDE STUB (no API calls). State
 * transitions are validated locally by the shared state machine.
 */
import { validateTransition, isDeclarationStatus, type DeclarationStatus, type TransitionResult } from "./state-machine";

export type ProviderError = "not_configured" | "unavailable" | "invalid_declaration" | "rejected" | "timeout";

export type SubmitInput = { declarationId: string; reference: string | null; officeCode: string | null; regime: string | null };
export type SubmitResult = { ok: true; externalReference: string; status: DeclarationStatus } | { ok: false; error: ProviderError };
export type PollResult = { ok: true; status: DeclarationStatus } | { ok: false; error: ProviderError };
export type CancelResult = { ok: true } | { ok: false; error: ProviderError };

export interface CustomsProvider {
  readonly name: string;
  /** Whether the provider can actually talk to an external system right now. */
  readonly configured: boolean;
  submit(input: SubmitInput): Promise<SubmitResult>;
  poll(externalReference: string): Promise<PollResult>;
  cancel(externalReference: string): Promise<CancelResult>;
}

/** The current reality: no external system — the tenant tracks customs manually. The
 *  "submit" is a local acknowledgement; poll/cancel are no-ops that never invent a status. */
export class ManualProvider implements CustomsProvider {
  readonly name = "manual";
  readonly configured = true;
  async submit(input: SubmitInput): Promise<SubmitResult> {
    return { ok: true, externalReference: `MANUAL-${input.declarationId}`, status: "SUBMITTED" };
  }
  async poll(): Promise<PollResult> {
    return { ok: false, error: "not_configured" }; // manual has no live status to poll
  }
  async cancel(): Promise<CancelResult> {
    return { ok: true };
  }
}

/** GAINDE (Sénégal) — STUB for 7.1A. No API calls; every op reports not_configured until
 *  7.1B wires the real integration. Present so services + tests target the real interface. */
export class GaindeProvider implements CustomsProvider {
  readonly name = "GAINDE";
  readonly configured = false;
  async submit(): Promise<SubmitResult> { return { ok: false, error: "not_configured" }; }
  async poll(): Promise<PollResult> { return { ok: false, error: "not_configured" }; }
  async cancel(): Promise<CancelResult> { return { ok: false, error: "not_configured" }; }
}

export const CUSTOMS_PROVIDERS = ["manual", "GAINDE"] as const;
export type CustomsProviderName = (typeof CUSTOMS_PROVIDERS)[number];

/** Resolve a provider by name (future providers register here). Defaults to manual. */
export function resolveProvider(name?: string | null): CustomsProvider {
  if (name === "GAINDE") return new GaindeProvider();
  return new ManualProvider();
}

/**
 * The facade every platform service uses — never a provider directly. It validates lifecycle
 * transitions LOCALLY (the shared state machine, the platform's source of truth) and
 * delegates external submission/polling to the bound provider. No transition is ever driven
 * purely by a provider response without local validation.
 */
export class CustomsEngine {
  constructor(private readonly provider: CustomsProvider) {}

  get providerName(): string {
    return this.provider.name;
  }
  get providerConfigured(): boolean {
    return this.provider.configured;
  }

  /** Validate a lifecycle transition (local authority). */
  transition(from: DeclarationStatus, to: DeclarationStatus): TransitionResult {
    return validateTransition(from, to);
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    return this.provider.submit(input);
  }

  /** Poll external status, then LOCALLY validate the implied transition before accepting it. */
  async poll(from: DeclarationStatus, externalReference: string): Promise<PollResult & { accepted?: boolean }> {
    const res = await this.provider.poll(externalReference);
    if (!res.ok) return res;
    if (!isDeclarationStatus(res.status)) return { ok: false, error: "unavailable" };
    const accepted = res.status === from || this.transition(from, res.status).ok;
    return { ...res, accepted };
  }

  async cancel(externalReference: string): Promise<CancelResult> {
    return this.provider.cancel(externalReference);
  }
}
