/**
 * Payment-provider registry (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves a provider implementation by name. The service/action layer goes
 * through here and never imports a concrete provider directly, so adding a real
 * provider later is a one-line registry change.
 */
import "server-only";
import type { ProviderName } from "../payment-intent";
import { ProviderError, type PaymentProvider } from "./types";
import { MockProvider } from "./mock";
import { WaveProvider } from "./wave";
import { OrangeMoneyProvider } from "./orange-money";

const REGISTRY: Record<ProviderName, PaymentProvider> = {
  MOCK: MockProvider,
  WAVE: WaveProvider,
  ORANGE_MONEY: OrangeMoneyProvider,
};

export function getPaymentProvider(name: ProviderName): PaymentProvider {
  const provider = REGISTRY[name];
  if (!provider) throw new ProviderError("unknown_provider", `No provider for "${name}".`);
  return provider;
}

export { ProviderError } from "./types";
export type { PaymentProvider, ProviderEvent, ProviderCheckout } from "./types";
