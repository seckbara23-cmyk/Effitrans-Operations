/**
 * AI request diagnostics (Phase 3.4F-1) — SERVER-ONLY, SECRET-FREE.
 * ---------------------------------------------------------------------------
 * One structured line per provider attempt via the shared observability sink.
 * NEVER logs the API key / Authorization header, the prompt, or the dossier
 * content — only non-sensitive metadata (provider, model, host, whether a
 * credential is present as a bool, HTTP status, outcome, error code).
 */
import "server-only";
import { reportMessage } from "@/lib/observability/report";

export type AIDiag = {
  provider: string;
  model: string;
  host: string;
  credentialsPresent: boolean;
  httpStatus: number | null;
  outcome: string;
  errorCode?: string | null;
  latencyMs?: number | null;
  /** Non-secret upstream error message (already stripped of any body/secret). */
  detail?: string | null;
};

export function logAIRequest(diag: AIDiag): void {
  reportMessage("ai provider call", {
    scope: "route",
    event: "ai.request",
    extra: { ...diag },
  });
}
