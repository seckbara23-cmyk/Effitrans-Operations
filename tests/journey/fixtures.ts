/**
 * Journey fixtures — created through the LEGITIMATE application path only.
 * ---------------------------------------------------------------------------
 * No SQL manipulates process state anywhere in this harness. Identities are the
 * one thing seeded directly, because "who exists and what roles they hold" is
 * tenant configuration, not workflow state — the equivalent of an administrator
 * having created the accounts in `/users` before the rehearsal. Everything that
 * MOVES a dossier goes through a server action.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth/current-user";

export const TENANT_A = "00000000-0000-0000-0000-000000000001";

export function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "journey harness requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(the CI rls-tests job's local Supabase). Refusing to run against nothing.",
    );
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}

/**
 * Resolve one of the pre-seeded journey identities by label.
 *
 * The identities are created by `supabase/tests/journey_identities.sql` in the
 * CI job — fixture CONFIGURATION, the equivalent of an administrator having made
 * the accounts before a rehearsal. They are RESOLVED here, never created:
 * PostgREST does not expose `auth`, and `service_role` holds no INSERT grant on
 * `app_user`, so creating them from the harness would mean reaching around the
 * very boundaries that make an identity real.
 *
 * Permissions are NOT stubbed. Whatever this identity can do is resolved from
 * its real role grants by the real RBAC code, exactly as in production.
 */
export async function identity(label: string): Promise<CurrentUser> {
  const email = `journey.${label}@test.local`;
  const admin = db();

  const { data: user, error } = await admin
    .from("app_user")
    .select("id, tenant_id, email")
    .eq("email", email)
    .maybeSingle();
  if (error || !user) {
    // Surface the UNDERLYING cause. The first version of this message said only
    // "not found", which hid a privilege error behind a fixture-ordering story.
    throw new Error(
      `identity(${label}): could not resolve ${email}. ` +
        `error=${error ? `${error.code ?? ""} ${error.message}` : "none"} row=${JSON.stringify(user)}`,
    );
  }

  const { data: rows } = await admin
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", user.id);
  const roles = (rows ?? [])
    .map((r) => (r as { role: { code: string } | { code: string }[] | null }).role)
    .map((rel) => (Array.isArray(rel) ? rel[0] : rel))
    .map((rel) => rel?.code)
    .filter((c): c is string => Boolean(c));

  if (roles.length === 0) throw new Error(`identity(${label}): no roles granted`);

  return {
    id: user.id as string,
    tenantId: user.tenant_id as string,
    email: user.email as string,
    isSystemAdmin: false,
    roles,
  };
}

/** The two journey clients seeded alongside the identities. */
export const CLIENT_DEPOSIT_REQUIRED = "00000000-0000-0000-0000-0000000cc001";
export const CLIENT_NO_DEPOSIT = "00000000-0000-0000-0000-0000000cc002";

/** Read an execution row — ASSERTION ONLY. The harness never writes these. */
export async function execution(fileId: string, stepKey: string) {
  const { data } = await db()
    .from("process_step_execution")
    .select("id, state, assigned_user_id, started_at, submitted_by, submitted_at, completed_at, reviewed_by, completion_provenance, reconciled_fact, process_instance_id")
    .eq("step_key", stepKey)
    .in(
      "process_instance_id",
      (await db().from("process_instance").select("id").eq("file_id", fileId)).data?.map((r) => r.id) ?? [],
    )
    .maybeSingle();
  return data;
}

/** Read audit rows for an entity — ASSERTION ONLY. */
export async function auditFor(action: string, entityId: string) {
  const { data } = await db()
    .from("audit_log")
    .select("action, actor_id, entity, entity_id, after, occurred_at")
    .eq("action", action)
    .eq("entity_id", entityId);
  return data ?? [];
}

/** The single open handoff on a dossier, if any — ASSERTION ONLY. */
export async function handoffs(fileId: string) {
  const inst = (await db().from("process_instance").select("id").eq("file_id", fileId)).data ?? [];
  const { data } = await db()
    .from("process_handoff")
    .select("id, from_step_key, to_step_key, status, sent_by, received_by")
    .in("process_instance_id", inst.map((r) => r.id));
  return data ?? [];
}

/**
 * Put REAL verified evidence of `typeCode` on a dossier, the way the business
 * does: one person uploads it, a DIFFERENT person verifies it.
 *
 * No SQL, no status forcing. The two-actor shape is not decoration — maker
 * ≠ checker is enforced both in `verifyDocument` and by a trigger on
 * `document_review`, so a helper that used one identity for both halves would
 * be refused, and a helper that wrote the row directly would prove nothing.
 */
export async function provideEvidence(
  fileId: string,
  keyOrTypeCode: string,
  uploader: CurrentUser,
  verifier: CurrentUser,
): Promise<string> {
  const { uploadDocument, verifyDocument } = await import("@/lib/documents/actions");
  const { DOCUMENT_MAPPINGS } = await import("@/lib/process/documents");
  const { as } = await import("./identity");

  // An EVIDENCE KEY is not a document TYPE CODE, and most of the time they
  // happen to be spelled the same — which is why passing the key through
  // worked until SIGNED_DELIVERY_NOTE (type DELIVERY_NOTE) and RECEIPT /
  // PAYMENT_PROOF (both type PAYMENT_RECEIPT). The registry owns that mapping,
  // so the harness reads it instead of restating it. A caller may pass either.
  const mapped = DOCUMENT_MAPPINGS.find((d) => d.key === keyOrTypeCode)?.typeCode;
  const typeCode = mapped ?? keyOrTypeCode;

  const fd = new FormData();
  fd.set("typeCode", typeCode);
  // A REAL allowed type. text/plain is refused by validateDocumentInput
  // (invalid_mime), and the harness must satisfy the platform's rules rather
  // than route around them — the upload path under test includes that check.
  fd.set(
    "file",
    new File([`%PDF-1.4 journey evidence for ${typeCode}`], `${typeCode.toLowerCase()}.pdf`, {
      type: "application/pdf",
    }),
  );

  const up = await as(uploader, () => uploadDocument(fileId, fd));
  if (!up.ok) {
    throw new Error(
      `provideEvidence(${keyOrTypeCode} -> type ${typeCode}): upload failed: ${JSON.stringify(up)}`,
    );
  }
  const docId = (up as { id: string }).id;

  const ver = await as(verifier, () => verifyDocument(docId));
  if (!ver.ok) {
    throw new Error(
      `provideEvidence(${keyOrTypeCode} -> type ${typeCode}): verify failed: ${JSON.stringify(ver)}`,
    );
  }
  return docId;
}

/** The customs record id for a dossier — ASSERTION/ACTION INPUT ONLY. */
export async function customsIdFor(fileId: string): Promise<string> {
  const { data } = await db().from("customs_record").select("id").eq("file_id", fileId).maybeSingle();
  if (!data) throw new Error(`no customs record on ${fileId}`);
  return data.id as string;
}

/** The transport record for a dossier — id + updated_at for the CAS write. */
export async function transportFor(fileId: string): Promise<{ id: string; updatedAt: string }> {
  const { data } = await db()
    .from("transport_record")
    .select("id, updated_at")
    .eq("file_id", fileId)
    .maybeSingle();
  if (!data) throw new Error(`no transport record on ${fileId}`);
  return { id: data.id as string, updatedAt: data.updated_at as string };
}

/** The dossier row itself — for closure assertions. */
export async function fileRow(fileId: string) {
  const { data } = await db()
    .from("operational_file")
    .select("id, file_number, status, closed_at")
    .eq("id", fileId)
    .maybeSingle();
  return data;
}
