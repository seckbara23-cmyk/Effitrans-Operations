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
import type { LicenceStatus, ReferenceCategory, ReferenceStatus, ScanStatus } from "./types";
import { dispatchScan, scanningAvailable } from "./scan";

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
  scan_status: ScanStatus;
  submitted_for_publication_by: string | null;
  storage_path: string;
  content_sha256: string;
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
      "id, category, status, licence_status, provenance_verified, legal_version_verified, title, "
      + "supersedes_id, scan_status, submitted_for_publication_by, storage_path, content_sha256",
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
  // REF-1-HARDEN (F4) — a withdrawn document is frozen. `recordVerifications`
  // already refused one and this did not, so a licence could be re-ruled on a
  // text nobody can consult. `trg_customs_reference_identity` refuses it in the
  // database too; this is the half that gives the operator a sentence.
  if (doc.status === "WITHDRAWN") return { ok: false, error: "withdrawn" };

  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update({
      licence_status: licenceStatus,
      redistribution_allowed: licenceStatus === "APPROVED_REDISTRIBUTION",
      licence_note: trimmed,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .neq("status", "WITHDRAWN")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "withdrawn" };

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

  // Named refusals, in the operator's terms, before the database speaks. This
  // decides nothing: `publish_customs_reference` re-checks every one of them
  // under a row lock, and it is the only thing that can actually publish.
  const blockers = publicationBlockers({
    status: doc.status,
    category: doc.category,
    licenceStatus: doc.licence_status,
    provenanceVerified: doc.provenance_verified,
    legalVersionVerified: doc.legal_version_verified,
    scanStatus: doc.scan_status,
    submittedForPublicationBy: doc.submitted_for_publication_by,
    approverId: user.id,
  });
  if (blockers.length > 0) return { ok: false, error: blockers[0] };

  // ONE transaction for the predecessor's retirement and this publication.
  // REF-1-HARDEN left those as two PostgREST writes with a compensating undo
  // and a stated residual window; this closes it.
  const { data, error } = await supabase.rpc("publish_customs_reference", {
    p_document: id,
    p_tenant: user.tenantId,
    p_approver: user.id,
  });
  if (error) return { ok: false, error: error.message };

  const outcome = String(data ?? "");
  if (outcome !== "published") return { ok: false, error: outcome };

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
      scan_status: doc.scan_status,
      submitted_by: doc.submitted_for_publication_by,
      approved_by: user.id,
    },
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}

/**
 * Submit for publication — the MAKER's act.
 *
 * Separate from approval on purpose: publication asserts that a text is the
 * current authoritative law, and that assertion now carries two actors and two
 * moments. The same permission governs both halves, because splitting it into
 * `submit` and `approve` codes would let a tenant grant one without the other
 * and quietly recreate single-handed publication from the other side. The
 * separation that matters is between two PEOPLE on one document, and the
 * database enforces it as a property of the row.
 */
export async function submitForPublication(id: string): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.rpc("submit_customs_reference_for_publication", {
    p_document: id,
    p_tenant: user.tenantId,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: error.message };

  const outcome = String(data ?? "");
  if (outcome !== "submitted") return { ok: false, error: outcome };

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_SUBMITTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    after: { submitted_by: user.id },
  });
  revalidatePath(LIBRARY_PATH);
  return { ok: true, id };
}

/**
 * Hand the stored object to the malware scanner.
 *
 * It moves UNSCANNED or ERROR to SCANNING and dispatches. It CANNOT produce a
 * verdict: only the signed callback can, through a database function this
 * module has no way of reaching. With no scanner configured it refuses rather
 * than pretending, which leaves the document unpublishable — the correct
 * failure, and the one the absence of a scanner should cause.
 *
 * A failed dispatch puts the status back, so a document is never stranded in
 * SCANNING by an outage that never started.
 */
export async function requestScan(id: string): Promise<ReferenceActionResult> {
  let user;
  try { user = await assertPermission("customs:reference:publish"); }
  catch { return { ok: false, error: "forbidden" }; }

  if (!scanningAvailable()) return { ok: false, error: "scanner_unavailable" };

  const supabase = getAdminSupabaseClient();
  const doc = await loadGoverned(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.status === "WITHDRAWN") return { ok: false, error: "withdrawn" };
  if (doc.scan_status !== "UNSCANNED" && doc.scan_status !== "ERROR") {
    return { ok: false, error: "scan_not_requestable" };
  }

  const previous = doc.scan_status;
  const { data: moved, error } = await supabase
    .from("customs_reference_document")
    .update({
      scan_status: "SCANNING",
      scan_requested_at: new Date().toISOString(),
      scan_requested_by: user.id,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("scan_status", previous)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "scan_not_requestable" };

  const sent = await dispatchScan({
    documentId: id,
    tenantId: user.tenantId,
    storagePath: doc.storage_path,
    sha256: doc.content_sha256,
  });
  if (!sent.ok) {
    // Put it back: SCANNING with nothing scanning is a lie about the state.
    await supabase
      .from("customs_reference_document")
      .update({ scan_status: previous })
      .eq("id", id)
      .eq("tenant_id", user.tenantId)
      .eq("scan_status", "SCANNING");
    return { ok: false, error: sent.error };
  }

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_SCAN_REQUESTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: id,
    before: { scan_status: previous },
    after: { scan_status: "SCANNING", sha256: doc.content_sha256 },
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
      // OPERATOR, not SCAN: a person ended this one, and the coherence CHECK
      // keeps the two kinds of withdrawal distinguishable for ever.
      withdrawn_source: "OPERATOR",
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
