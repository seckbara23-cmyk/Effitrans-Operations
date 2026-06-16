/**
 * Provider-agnostic error / event reporting (Phase 1.18 — C1). ISOMORPHIC
 * (safe on client, server, edge). Dependency-free by design.
 * ---------------------------------------------------------------------------
 * This is the SINGLE integration point for an error monitor. Today it emits one
 * structured line per event to the console — captured by the Vercel runtime log
 * drain and Supabase logs, and greppable by `[observe]`. It degrades gracefully
 * (logs only) until a monitor is wired, mirroring the queue-first no-op comms
 * provider and the dark-by-default payment providers.
 *
 * To enable Sentry (see docs/monitoring-verification.md §Rollout):
 *   1. `npm i @sentry/nextjs`
 *   2. init it in `instrumentation.ts` (server/edge) + a client init,
 *      reading NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN.
 *   3. in `reportError` below, forward when `monitoringEnabled()`:
 *        Sentry.captureException(err, { tags: { scope, event }, extra });
 * No call sites change — they already route through here.
 */

export type ErrorScope =
  | "client"
  | "server"
  | "route"
  | "action"
  | "auth"
  | "portal"
  | "comms"
  | "webhook";

export type ErrorContext = {
  scope: ErrorScope;
  /** Stable label for grouping, e.g. "payments.webhook", "auth.callback". */
  event: string;
  /** Non-sensitive extra fields. NEVER include secrets or PII beyond ids. */
  extra?: Record<string, unknown>;
};

/** True once a DSN is configured. Forwarding is wired when the SDK is added. */
export function monitoringEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);
}

/** Report a caught error. Always logs; forwards to the monitor once wired. */
export function reportError(error: unknown, context: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const line = {
    level: "error",
    scope: context.scope,
    event: context.event,
    message: err.message,
    monitored: monitoringEnabled(),
    ...(context.extra ? { extra: context.extra } : {}),
  };
  console.error(`[observe] ${JSON.stringify(line)}`, err.stack ?? "");
  // INTEGRATION POINT — forward to Sentry here when monitoringEnabled().
}

/** Report a noteworthy non-exception event (degraded path, rejected access). */
export function reportMessage(message: string, context: ErrorContext): void {
  const line = {
    level: "warning",
    scope: context.scope,
    event: context.event,
    message,
    monitored: monitoringEnabled(),
    ...(context.extra ? { extra: context.extra } : {}),
  };
  console.warn(`[observe] ${JSON.stringify(line)}`);
}
