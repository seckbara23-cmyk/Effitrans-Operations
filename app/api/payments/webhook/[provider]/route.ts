/**
 * Provider payment-webhook endpoint (Phase 1.15B). Route Handler (machine-to-
 * machine; no auth cookie — secured entirely by signature verification inside
 * processWebhook). Reads the RAW body (signature is computed over it), passes
 * headers through, and returns the provider-appropriate HTTP status.
 *
 * Disabled unless PAYMENTS_ENABLED=true. Real providers stay `not_configured`
 * (503) until credentials land; only the Mock provider completes a flow.
 */
import { NextResponse } from "next/server";
import { paymentsEnabled } from "@/lib/finance/providers/config";
import { processWebhook } from "@/lib/finance/webhook";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto for HMAC verification

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  if (!paymentsEnabled()) {
    return NextResponse.json({ error: "payments_disabled" }, { status: 503 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const result = await processWebhook(params.provider, rawBody, headers);
    return NextResponse.json(
      { outcome: result.outcome, detail: result.detail ?? null },
      { status: result.httpStatus },
    );
  } catch (e) {
    // Never leak internals to the caller; the failure is audited server-side.
    reportError(e, { scope: "webhook", event: "payments.webhook", extra: { provider: params.provider } });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
