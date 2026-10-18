/**
 * Customs Reference Library — mint a direct-to-storage upload ticket.
 * CUSTOMS-REF-01A / REF-2, step 1 of 2.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The REF-1 upload route carries the bytes through a
 * serverless function, so it is bounded by the platform's 4.5 MB request limit
 * and `MAX_UPLOAD_BYTES` states 4 MB. The Tarif Extérieur Commun is tens of
 * megabytes. This route mints a short-lived, single-path upload URL so the
 * bytes travel from the operator's browser straight into the private bucket,
 * and the only remaining ceiling is the bucket's own 50 MB.
 *
 * WHAT THIS ROUTE IS NOT. It is NOT the step that decides a document exists.
 * It creates no row, and the bytes it authorises land in a `_staging/` prefix
 * that nothing in the application reads. A document appears only when
 * `/finalize` has read those bytes, found them to be a PDF of the declared size
 * and hash, and written the row itself.
 *
 * THE VALIDATION HERE IS A COURTESY, NOT THE BOUNDARY. Everything checked
 * below is checked again by `/finalize`, which is the sole authority. It is
 * done twice because refusing a missing reference code BEFORE a 40 MB transfer
 * is kind, and refusing it after is the actual guarantee.
 *
 * SECURITY, in the order it is enforced:
 *   1. a STAFF session is required — `getCurrentPortalUser` is never consulted,
 *      so no portal account can reach this;
 *   2. `customs:reference:publish` is required — reading is not authority to add;
 *   3. the declared size must fall inside the bucket's own bounds, so an
 *      upload that storage would reject is refused before it starts;
 *   4. the object key is derived from the SESSION's tenant and a
 *      server-generated uuid. The caller supplies no part of any path.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isReferenceCategory } from "@/lib/customs/reference/types";
import {
  MAX_DIRECT_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  buildStagingPath,
  normalizeRegimes,
  parseRegimeInput,
  validateReferenceMetadata,
} from "@/lib/customs/reference/validate";
import { sweepAbandonedStaging } from "@/lib/customs/reference/staging-sweep";

export const dynamic = "force-dynamic";

const BUCKET = "customs-reference";

export async function POST(request: Request) {
  // ---- who is asking -------------------------------------------------------
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:reference:publish")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }

  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const nullable = (k: string): string | null => {
    const v = str(k).trim();
    return v.length > 0 ? v : null;
  };

  const category = str("category");
  const declaredSize = Number(body.declaredSize);

  const meta = validateReferenceMetadata({
    title: str("title"),
    sourceAuthority: str("sourceAuthority"),
    referenceCode: nullable("referenceCode"),
    categoryValid: isReferenceCategory(category),
    publishedOn: nullable("publishedOn"),
  });
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 400 });

  const regimes = normalizeRegimes(parseRegimeInput(nullable("customsRegimes")));
  if (!regimes.ok) return NextResponse.json({ error: regimes.error }, { status: 400 });

  // ---- the size, before a byte moves --------------------------------------
  if (!Number.isFinite(declaredSize) || !Number.isInteger(declaredSize) || declaredSize <= 0) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (declaredSize < MIN_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_small" }, { status: 400 });
  }
  if (declaredSize > MAX_DIRECT_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  // ---- the ticket ----------------------------------------------------------
  // The uuid is generated HERE. It is the only variable part of the key, and
  // `/finalize` rebuilds the same path from the session's tenant and a uuid it
  // re-validates, so no caller-supplied string ever reaches a storage path.
  const uploadId = randomUUID();
  const stagingPath = buildStagingPath(user.tenantId, uploadId);

  const supabase = getAdminSupabaseClient();

  // REF-2 F-2 — reclaim this tenant's abandoned staging bytes before minting
  // another ticket. There is no scheduler in this system to hang a sweeper on,
  // and this is the one door where somebody has already proved authority over
  // this tenant's staging prefix. AWAITED, because a serverless function stops
  // executing once it has answered; and best-effort by contract, so a janitorial
  // failure can never be the reason an authorized upload is refused. The ticket
  // minted below has no object yet, so the sweep cannot reach it.
  await sweepAbandonedStaging(supabase, user.tenantId);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(stagingPath);

  if (error || !data) {
    return NextResponse.json({ error: "ticket_failed" }, { status: 503 });
  }

  // No audit event here on purpose: nothing has happened yet that the ledger
  // should carry. An upload ticket that is never used must leave no trace of a
  // document that never existed. `/finalize` writes the audit event, and it
  // writes it for a document that demonstrably exists.
  return NextResponse.json(
    {
      ok: true,
      uploadId,
      // The client needs the path and token to call `uploadToSignedUrl`. The
      // path is already known to the caller's tenant and grants nothing on its
      // own: the bucket is private and has no `storage.objects` policy.
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      maxBytes: MAX_DIRECT_UPLOAD_BYTES,
    },
    { status: 201 },
  );
}
