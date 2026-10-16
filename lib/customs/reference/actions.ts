"use server";

/**
 * Customs Reference Library — the governance acts. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * CUSTOMS-REF-01A / REF-1. Four acts, each behind `customs:reference:publish`,
 * each a compare-and-set, each audited after the row actually moved.
 *
 *   recordVerifications   a human affirms provenance and/or the legal version
 *   recordLicenceRuling   a human rules on the licence
 *   publishDocument       QUARANTINE -> PUBLISHED
 *   withdrawDocument      PUBLISHED  -> WITHDRAWN
 *
 * WHY THESE ARE FOUR ACTS AND NOT ONE FORM. Publication asserts that a
 * document is the current authoritative text. The two verifications and the
 * licence ruling are the FACTS that assertion rests on, and each is somebody's
 * separate professional judgement made at a separate moment. Collapsing them
 * into one button would record one timestamp for three decisions and leave no
 * way to show, afterwards, that the provenance was ever actually checked.
 *
 * EVERY WRITE IS A COMPARE-AND-SET WITH `.select()`. PostgREST reports NO error
 * for an UPDATE that matched nothing (POD-FINANCE-CONVERGENCE-01), so the row
 * count is the only truthful signal that the act landed. Without it, two
 * publishers clicking at once would both be told `ok`.
 *
 * THE DATABASE REMAINS THE AUTHORITY. `publicationBlockers` is re-checked here
 * so the operator gets a French sentence instead of a constraint violation, but
 * migration 152's CHECKs are what actually make an unverified publication
 * unrepresentable. This layer is the explanation, not the guarantee.
 *
 * NO HARD DELETE EXISTS IN THIS MODULE, deliberately. Withdrawal ends
 * consultability; the row and the bytes remain, because a reference library
 * whose superseded editions vanish cannot answer "what did the tariff say when
 * we filed that declaration".
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isLicenceStatus, publicationBlockers, type ReferenceActionResult } from "./types";
import type { LicenceStatus, ReferenceCategory, ReferenceStatus } from "./types";

const LIBRARY_PATH = "/customs/reference";

type GovernedRow = {
  id: string;
  category: ReferenceCategory;
  status: ReferenceStatus;
  licence_status: LicenceStatus;
  provenance_verified: boolean;
  legal_version_verified: boolean;
  title: string;
  supersedes_id: string | null;
};

/** Load a row the caller is entitled to govern. Tenant-scoped, always. */
async function loadGoverned(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  id: string,
  tenantId: string,
): Promise<GovernedRow | null> {
  const { data } = await supabase
    .from("customs_reference_document")
    .select(
      "id, category, status, licence_status, provenance_verified, legal_version_verified, title, supersedes_id",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<GovernedRow>();
  return data ?? null;
}

/**
 * Affirm provenance and/or the legal version.
 *
 * Only ever sets a flag to true: there is no "un-verify" here, because the way
 * back from a mistaken verification is withdrawal, which is attributed. A flag
 * that could be quietly cleared would let a published document's basis
 * disappear while the publication stood.
 */
export async function recordVerifications(
  id: string,
  input: { provenance?: boolean; legalVersion?: boolean },
): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  if (!input.provenance && !input.legalVersion) return { ok: false, error: "nothing_to_record" };

  const supabase = getAdminSupabaseClient();
  const doc = await loadGoverned(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.status === "WITHDRAWN") return { ok: false, error: "withdrawn" };

  const patch: { provenance_verified?: boolean; legal_version_verified?: boolean } = {};
  if (input.provenance) patch.provenance_verified = true;
  if (input.legalVersion) patch.legal_version_verified = true;

  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .neq("status", "WITHDRAWN")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "withdrawn" };

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_VERIFIED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    before: {
      provenance_verified: doc.provenance_verified,
      legal_version_verified: doc.legal_version_verified,
    },
    after: patch,
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}

/**
 * Rule on the licence.
 *
 * `redistribution_allowed` is derived from the ruling rather than accepted as a
 * separate input: the two cannot be allowed to disagree, and migration 152
 * refuses the combination anyway. A ruling always carries a note — "who told us
 * this, and when" is the only thing that makes a licence claim auditable.
 */
export async function recordLicenceRuling(
  id: string,
  licenceStatus: string,
  note: string,
): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  if (!isLicenceStatus(licenceStatus)) return { ok: false, error: "licence_invalid" };
  const trimmed = note.trim();
  if (trimmed.length === 0) return { ok: false, error: "licence_note_required" };

  const supabase = getAdminSupabaseClient();
  const doc = await loadGoverned(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };

  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update({
      licence_status: licenceStatus,
      redistribution_allowed: licenceStatus === "APPROVED_REDISTRIBUTION",
      licence_note: trimmed,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "not_found" };

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_LICENCE_RECORDED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    before: { licence_status: doc.licence_status },
    after: { licence_status: licenceStatus, note: trimmed },
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}

/**
 * Publish: QUARANTINE -> PUBLISHED.
 *
 * The CAS predicate is `status = 'QUARANTINE'`, so a document that a concurrent
 * publisher already moved matches zero rows and the loser is told so rather
 * than being handed a second publication record.
 */
export async function publishDocument(id: string): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const doc = await loadGoverned(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };

  // Named refusals, in the operator's terms, before the constraint speaks.
  const blockers = publicationBlockers({
    status: doc.status,
    category: doc.category,
    licenceStatus: doc.licence_status,
    provenanceVerified: doc.provenance_verified,
    legalVersionVerified: doc.legal_version_verified,
  });
  if (blockers.length > 0) return { ok: false, error: blockers[0] };

  // ---- supersession comes FIRST, and the order is load-bearing -------------
  // `uq_customs_reference_one_current` admits one PUBLISHED, un-superseded row
  // per (tenant, category, reference_code). Publishing a replacement while its
  // predecessor is still current would therefore violate that index and fail.
  // So the predecessor is retired first, and the publish is compensated if it
  // does not land.
  //
  // The CAS predicate is `superseded_by_id is null`, so a concurrent publisher
  // who already retired this predecessor matches zero rows and we stop rather
  // than overwrite their supersession with ours.
  const supersededAt = new Date().toISOString();
  if (doc.supersedes_id) {
    const { data: retired, error: retireErr } = await supabase
      .from("customs_reference_document")
      .update({ superseded_by_id: id, superseded_at: supersededAt })
      .eq("id", doc.supersedes_id)
      .eq("tenant_id", user.tenantId)
      .is("superseded_by_id", null)
      .select("id");
    if (retireErr) return { ok: false, error: retireErr.message };
    if ((retired?.length ?? 0) !== 1) {
      return { ok: false, error: "predecessor_already_superseded" };
    }
  }

  const publishedAt = new Date().toISOString();
  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update({ status: "PUBLISHED", published_by: user.id, published_at: publishedAt })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("status", "QUARANTINE")
    .select("id");

  // Compensate a failed publish by restoring the predecessor. The predicate is
  // `superseded_by_id = id`, which is OUR supersession and nobody else's, so
  // this can never clobber a concurrent publisher's work.
  //
  // RESIDUAL, AND STATED RATHER THAN HIDDEN: a crash between the two writes
  // leaves the predecessor retired while the replacement is still QUARANTINE,
  // so that business key shows no current version until the replacement is
  // published — one click, and visible in the list. PostgREST cannot span two
  // rows in one transaction; closing this window entirely needs a definer RPC,
  // which is REF-2 work and is not pretended to exist here.
  if (error || (moved?.length ?? 0) !== 1) {
    if (doc.supersedes_id) {
      await supabase
        .from("customs_reference_document")
        .update({ superseded_by_id: null, superseded_at: null })
        .eq("id", doc.supersedes_id)
        .eq("tenant_id", user.tenantId)
        .eq("superseded_by_id", id);
    }
    if (error) return { ok: false, error: error.message };
    return { ok: false, error: "already_published" };
  }

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_PUBLISHED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    before: { status: doc.status },
    after: {
      status: "PUBLISHED",
      title: doc.title,
      category: doc.category,
      licence_status: doc.licence_status,
      published_at: publishedAt,
    },
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}

/**
 * Withdraw: PUBLISHED -> WITHDRAWN. Ends consultability, destroys nothing.
 *
 * A reason is mandatory. "Why is the tariff no longer available" is the first
 * question anyone will ask, and an unexplained withdrawal is indistinguishable
 * from an accident.
 */
export async function withdrawDocument(
  id: string,
  reason: string,
): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, error: "reason_required" };

  const supabase = getAdminSupabaseClient();
  const doc = await loadGoverned(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.status === "WITHDRAWN") return { ok: false, error: "already_withdrawn" };

  const withdrawnAt = new Date().toISOString();
  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update({
      status: "WITHDRAWN",
      withdrawn_by: user.id,
      withdrawn_at: withdrawnAt,
      notes: trimmed,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .neq("status", "WITHDRAWN")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "already_withdrawn" };

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_WITHDRAWN,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    before: { status: doc.status },
    after: { status: "WITHDRAWN", reason: trimmed, withdrawn_at: withdrawnAt },
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}
