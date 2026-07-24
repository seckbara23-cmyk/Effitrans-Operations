/**
 * Unified Alert Center — the registered source adapters (Phase 10.0E-2).
 * ---------------------------------------------------------------------------
 * The seven ratified adapters (DEC-B53), in a stable order. Each consumes an
 * EXISTING bounded reader, self-gates on its SOURCE permission (`available`),
 * and lets failures reject (`unavailable`) — none owns a business rule. The
 * reader iterates this list under Promise.allSettled; adding a future adapter
 * is a one-line change here, never in the reader.
 */
import type { OperationalAlertAdapter } from "../types";
import { riskAdapter } from "./risk";
import { commandCenterAdapter } from "./command-center";
import { financeRequestsAdapter } from "./finance-requests";
import { reconciliationAdapter } from "./reconciliation";
import { receivablesAdapter } from "./receivables";
import { communicationsAdapter } from "./communications";
import { messagingAdapter } from "./messaging";

export const ALERT_ADAPTERS: readonly OperationalAlertAdapter[] = [
  riskAdapter,
  commandCenterAdapter,
  financeRequestsAdapter,
  reconciliationAdapter,
  receivablesAdapter,
  communicationsAdapter,
  messagingAdapter,
];
