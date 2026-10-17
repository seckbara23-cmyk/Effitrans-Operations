/**
 * Scanner callback — the ONE door a malware verdict enters by.
 * CUSTOMS-REF-01A / REF-1-PUBLISH-GATE, Part A.
 * ---------------------------------------------------------------------------
 * NO SESSION, AND NO SESSION IS ACCEPTED. This route is not reachable by a
 * person: it authenticates a MACHINE by HMAC over the raw body, and it never
 * consults `getCurrentUser` or `getCurrentPortalUser`. A browser cannot forge a
 * verdict here, and a logged-in publisher has no more standing than a stranger.
 *
 * AND IT CANNOT MANUFACTURE ONE EITHER. The route does not write the document.
 * It calls `record_customs_reference_scan`, a definer function revoked from
 * public, anon and authenticated, which re-checks that the verdict describes
 * the document's CURRENT bytes and current storage path before recording
 * anything. A verdict about other bytes is rejected by the database, not by
 * this file.
 *
 * FAIL CLOSED. With no scanner configured there is no secret, so every callback
 * is refused with 503 and nothing moves. A bad signature is 401. An
 * unrecognised verdict is 400. None of these leave a document CLEAN.
 *
 * The response is deliberately terse: a scanner is not an operator and gets no
 * French sentences, and an unauthenticated caller learns nothing about whether
 * the document exists.
 */
import { NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { parseCallback, scanningAvailable } from "@/lib/customs/reference/scan";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!scanningAvailable()) {
    // Not "unauthorised" — there is genuinely no scanner to believe.
    return NextResponse.json({ error: "scanner_unavailable" }, { status: 503 });
  }

  // The RAW body is what was signed; parsing first would change the bytes.
  const raw = await request.text();
  const signature =
    request.headers.get("x-effitrans-signature") ?? request.headers.get("x-signature");

  const parsed = parseCallback(raw, signature);
  if (!parsed.ok) {
    const status = parsed.error === "bad_signature" ? 401
      : parsed.error === "scanner_unavailable" ? 503
      // A stale callback is a REPLAY attempt or a badly lagged scanner; either
      // way it is refused, and 409 says "not acceptable now" rather than
      // "malformed".
      : parsed.error === "stale_callback" ? 409
      : 400;
    return NextResponse.json({ error: parsed.error }, { status });
  }

  const p = parsed.payload;
  const supabase = getAdminSupabaseClient();

  const { data, error } = await supabase.rpc("record_customs_reference_scan", {
    p_document: p.documentId,
    p_tenant: p.tenantId,
    p_verdict: p.verdict,
    p_sha256: p.sha256,
    p_storage_path: p.storagePath,
    p_scanner_name: process.env.CUSTOMS_SCAN_PROVIDER ?? "external-scanner",
    p_scanner_version: p.scannerVersion,
    p_engine_ref: p.engineRef,
    p_detail: p.detail,
    p_nonce: p.nonce,
  });
  if (error) return NextResponse.json({ error: "record_failed" }, { status: 503 });

  const outcome = String(data ?? "");
  // The function's own refusals. `binding_mismatch` is the interesting one: a
  // verdict that does not describe this document's bytes.
  // `replayed` is the database's own refusal: this callback's nonce has been
  // recorded before, so nothing was written. Reported distinctly from the
  // other refusals because it is the one that means somebody re-sent a message.
  if (outcome === "replayed") {
    return NextResponse.json({ error: "replayed" }, { status: 409 });
  }
  if (outcome === "not_found" || outcome === "binding_mismatch"
      || outcome === "invalid_verdict" || outcome === "scanner_required") {
    return NextResponse.json({ error: outcome }, { status: 409 });
  }

  // `system.`-prefixed, because there is no human actor and the audit validator
  // requires one for every other kind of action. A scanner is machine-caused
  // work and the ledger keeps the two distinguishable.
  await writeAudit({
    action: AuditActions.SYSTEM_CUSTOMS_REFERENCE_SCANNED,
    tenantId: p.tenantId,
    entity: "customs_reference_document",
    entityId: p.documentId,
    after: {
      verdict: p.verdict,
      outcome,
      sha256: p.sha256,
      engine_ref: p.engineRef,
      scanner_version: p.scannerVersion,
      nonce: p.nonce,
    },
  });

  return NextResponse.json({ ok: true, outcome }, { status: 200 });
}
