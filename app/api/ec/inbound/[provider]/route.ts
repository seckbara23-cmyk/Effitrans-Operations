/**
 * EC-1 — inbound email webhook endpoint. Route Handler (machine-to-machine; no
 * auth cookie, no session — secured entirely by signature verification inside
 * captureInbound). Reads the RAW body (the signature is computed over it),
 * passes headers through, and returns the provider-appropriate HTTP status.
 *
 * Modelled on app/api/payments/webhook/[provider]/route.ts, deliberately: that
 * endpoint is the platform's proven public-webhook shape.
 *
 * DARK unless EFFITRANS_EC_INBOUND_ENABLED=true (503). The check lives in
 * captureInbound so the flag is enforced in ONE place — a route that forgot it
 * would be the whole guard, and this way there is nothing to forget.
 *
 * The response body is a classification, never content: no subject, address,
 * filename or error internals ever cross this boundary.
 */
import { NextResponse } from "next/server";
import { captureInbound } from "@/lib/ec/inbound/capture";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto for HMAC verification

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  // The raw body FIRST — every later step reasons about these exact bytes.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "unreadable_body" }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const result = await captureInbound(params.provider, rawBody, headers);
    return NextResponse.json(
      { outcome: result.outcome, detail: result.detail ?? null },
      { status: result.httpStatus },
    );
  } catch (e) {
    reportError(e, { scope: "webhook", event: "ec.inbound.webhook", extra: { provider: params.provider } });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
