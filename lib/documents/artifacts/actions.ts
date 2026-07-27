"use server";
/**
 * Internal-artifact generation (Phase WES-4G). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The four-step contract, in order, and the order is the design:
 *
 *   1. READ the authoritative structured records.
 *   2. RESOLVE the source snapshot — refuses when a mandatory field is absent,
 *      so no PDF is ever rendered with a blank where a fact belongs.
 *   3. RENDER + HASH. Deterministic: same snapshot + same renderer version
 *      produces byte-identical output, so the hash is reproducible.
 *   4. STORE, then FINALIZE atomically. The object is written first; the
 *      database row is what makes those bytes an artifact. Until the row
 *      exists the object is an unreferenced blob, which is the survivable
 *      failure. See the migration header for every failure mode.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { buildStoragePath, removeObject, sha256Hex, uploadObject } from "@/lib/documents/storage";
import { isGeneratableArtifact } from "./feasibility";
import { canonicalizeSnapshot, resolveArtifactSource } from "./source";
import { readArtifactSource } from "./service";
import { RENDERER_VERSION, renderArtifact } from "./render";

export type GenerateResult =
  | { ok: true; documentId: string; version: number }
  | { ok: false; error: string; missing?: { field: string; labelFr: string }[] };

/** The document_type each artifact is filed under. */
const TYPE_CODE: Record<string, string> = {
  DEMANDE_TRANSPORT: "DEMANDE_TRANSPORT",
  TRANSPORT_ORDER: "TRANSPORT_ORDER",
};

/**
 * Generate (or regenerate) an internal artifact for a dossier.
 *
 * AUTHORIZATION (WES-4G.9). The WES-7 policy schema has no `generator` seat,
 * and inventing one would be an unratified policy concept. The narrowest
 * EXISTING authority that fits is `transport:manage`: both artifacts describe
 * the transport leg and are produced by whoever plans it. `document:create`
 * would have been wrong — it lets anyone who can attach a file issue an
 * operational order.
 */
export async function generateArtifact(input: {
  fileId: string;
  artifactCode: string;
}): Promise<GenerateResult> {
  if (!isGeneratableArtifact(input.artifactCode)) {
    return { ok: false, error: "artifact_not_generatable" };
  }

  let user;
  try {
    user = await assertPermission("transport:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, input.fileId))) {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();

  // ---- 1. the authoritative records ---------------------------------------
  // Shared with the panel (`readArtifactSource`): the completeness state the
  // operator sees and the refusal the generator applies come from ONE read.
  // Two implementations would drift, and the drift would look like a Générer
  // button that fails when pressed.
  const source = await readArtifactSource(supabase, user.tenantId, input.fileId);
  if (!source) return { ok: false, error: "not_found" };

  const { data: org } = await supabase
    .from("organization").select("name").eq("id", user.tenantId)
    .maybeSingle<{ name: string }>();

  // ---- 2. refuse rather than render blanks --------------------------------
  const resolved = resolveArtifactSource(input.artifactCode, source);
  if (!resolved.ok) {
    return { ok: false, error: "incomplete_source", missing: resolved.missing };
  }

  // ---- 3. render + hash ---------------------------------------------------
  const { data: current } = await supabase
    .from("document")
    .select("version")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", input.fileId)
    .eq("artifact_code", input.artifactCode)
    .is("superseded_by_id", null)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();
  const nextVersion = (current?.version ?? 0) + 1;

  let bytes: Uint8Array;
  try {
    bytes = renderArtifact({
      artifactCode: input.artifactCode,
      snapshot: resolved.snapshot,
      provenance: resolved.provenance,
      organizationName: org?.name ?? "",
      artifactVersion: nextVersion,
    });
  } catch {
    return { ok: false, error: "render_failed" };
  }

  const contentSha256 = sha256Hex(bytes);
  const sourceSha256 = sha256Hex(
    new TextEncoder().encode(canonicalizeSnapshot(resolved.snapshot)),
  );

  // ---- 4. store, then finalize atomically ---------------------------------
  const documentId = randomUUID();
  const path = buildStoragePath(user.tenantId, input.fileId, documentId, "pdf");

  const up = await uploadObject(path, bytes, "application/pdf");
  if (!up.ok) return { ok: false, error: "storage_failed" };

  const { data, error } = await supabase.rpc("finalize_generated_artifact", {
    p_document_id: documentId,
    p_tenant_id: user.tenantId,
    p_file_id: input.fileId,
    p_artifact_code: input.artifactCode,
    p_type_code: TYPE_CODE[input.artifactCode],
    p_storage_path: path,
    p_content_sha256: contentSha256,
    p_source_sha256: sourceSha256,
    p_source_snapshot: resolved.snapshot,
    p_renderer_version: RENDERER_VERSION,
    p_provenance: resolved.provenance,
    p_actor: user.id,
    p_size_bytes: bytes.byteLength,
    p_policy_id: null,
  });

  if (error) {
    // The object exists and nothing references it. Remove it best-effort; if
    // this also fails it stays as an unreferenced blob, which is harmless —
    // no row, no event, no artifact.
    await removeObject(path);
    return { ok: false, error: "finalize_failed" };
  }

  const result = data as { version: number } | null;

  await writeAudit({
    action: AuditActions.DOCUMENT_UPLOADED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: documentId,
    after: {
      artifact_code: input.artifactCode,
      version: result?.version ?? nextVersion,
      renderer_version: RENDERER_VERSION,
      content_sha256: contentSha256,
    },
  });

  revalidatePath(`/files/${input.fileId}`);
  return { ok: true, documentId, version: result?.version ?? nextVersion };
}
