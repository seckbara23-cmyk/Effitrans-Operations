"use server";
/**
 * Workflow policy lifecycle — server actions (Phase WES-7B/E). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Draft → validate → activate, plus the controlled dossier migration.
 *
 * AUTHORIZATION. Tenant policy is managed by holders of the EXISTING
 * `admin:config:manage` — workflow policy IS system configuration, and WES-7F
 * forbids inventing a privileged permission without evidence that one is needed.
 * The PLATFORM DEFAULT (tenant_id NULL) is a strictly narrower boundary: it is
 * managed only through the platform-admin identity, which is a separate table
 * and a separate auth path, never a tenant permission.
 *
 * ATOMICITY. Activation retires the previous version and promotes the new one in
 * ONE security-definer RPC. A partial activation would leave a scope with zero
 * or two active versions and the resolver would start refusing work.
 *
 * NO EVENT LEDGER. WES-9 is not started: these actions write the EXISTING audit
 * log and nothing else. No best-effort dual write is introduced.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getPlatformUser } from "@/lib/platform/auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { ALL_NODE_KEYS } from "@/lib/process/engine/state";
import { MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";
import { PROCESS_SLA_POLICIES } from "@/lib/process/sla-policies";
import { DOCUMENT_MAPPINGS } from "@/lib/process/documents";
import { PROCESS_DEPARTMENTS } from "@/lib/process/types";
import { TENANT_ROLE_KEYS } from "@/lib/platform/role-templates";
import { buildPlatformDefaultPolicy } from "./default";
import { policyContentSha256 } from "./hash";
import { validatePolicyDocument, type PolicyCatalogs } from "./validate";
import {
  POLICY_SCHEMA_VERSION,
  isPublished,
  type PolicyStatus,
  type WorkflowPolicyDocument,
} from "./schema";

export type PolicyActionError =
  | "forbidden"
  | "not_found"
  | "invalid_state"
  | "invalid_input"
  | "validation_failed"
  | "duplicate_content"
  | "reason_required"
  | "activation_failed";

export type PolicyActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: PolicyActionError; errors?: unknown };

const fail = (error: PolicyActionError, errors?: unknown): PolicyActionResult =>
  ({ ok: false, error, errors });

type Scope = { tenantId: string | null };
type Ctx = { actorId: string | null; tenantId: string; scope: Scope };

/**
 * Gate a policy operation. `platformDefault` requests the narrower boundary:
 * the caller must be a platform admin, not merely a tenant config manager.
 */
async function guard(platformDefault: boolean): Promise<Ctx | PolicyActionError> {
  if (platformDefault) {
    const platform = await getPlatformUser().catch(() => null);
    if (!platform) return "forbidden";
    // A platform actor is not an app_user; actor columns stay null and the audit
    // records the platform identity instead.
    return { actorId: null, tenantId: "", scope: { tenantId: null } };
  }
  try {
    const user = await assertPermission("admin:config:manage");
    return { actorId: user.id, tenantId: user.tenantId, scope: { tenantId: user.tenantId } };
  } catch {
    return "forbidden";
  }
}

const isErr = (v: Ctx | PolicyActionError): v is PolicyActionError => typeof v === "string";

/**
 * The live catalogs a validation runs against.
 *
 * ROLES ARE TENANT-SCOPED. A tenant policy is validated against THAT tenant's
 * own roles — reading the whole `role` table would let one tenant's policy
 * reference a role code that only exists in another tenant. The PLATFORM default
 * has no tenant, so it validates against the canonical role-template keys every
 * tenant is provisioned from. `permission` and `document_type` are global
 * catalogs by design (see lib/db/tenant-tables.ts GLOBAL_TABLES).
 */
async function loadCatalogs(tenantId: string | null): Promise<PolicyCatalogs> {
  const admin = getAdminSupabaseClient();
  const [roles, permissions, docTypes] = await Promise.all([
    tenantId === null
      ? Promise.resolve({ data: TENANT_ROLE_KEYS.map((code) => ({ code })) })
      : admin.from("role").select("code").eq("tenant_id", tenantId).returns<{ code: string }[]>(),
    admin.from("permission").select("code").returns<{ code: string }[]>(),
    admin.from("document_type").select("code").returns<{ code: string }[]>(),
  ]);

  return {
    stepKeys: ALL_NODE_KEYS,
    departments: PROCESS_DEPARTMENTS,
    roles: [...new Set((roles.data ?? []).map((r) => r.code))],
    permissions: (permissions.data ?? []).map((p) => p.code),
    // Both identifier spaces (see PolicyCatalogs.documentTypeCodes): the
    // uploadable document_type catalogue AND the official process document keys
    // the 26-step registry already references.
    documentTypeCodes: [
      ...new Set([
        ...(docTypes.data ?? []).map((d) => d.code),
        ...DOCUMENT_MAPPINGS.map((m) => m.key),
      ]),
    ],
    slaPolicyKeys: PROCESS_SLA_POLICIES.map((p) => p.key),
    makerCheckerPairs: MAKER_CHECKER_PAIRS.map((p) => ({
      preparerStep: p.preparerStep,
      validatorStep: p.validatorStep,
    })),
  };
}

function revalidate() {
  revalidatePath("/settings/workflow-policy");
}

// ================================================================ create draft ==

/**
 * Create a DRAFT, seeded from the current ACTIVE version of the scope, or from
 * the built-in default when none exists. Editing an active version is
 * impossible by construction: you always get a new draft.
 */
export async function createPolicyDraft(input: {
  platformDefault?: boolean;
  document?: WorkflowPolicyDocument;
}): Promise<PolicyActionResult<{ id: string; version: number }>> {
  const ctx = await guard(Boolean(input.platformDefault));
  if (isErr(ctx)) return fail(ctx) as PolicyActionResult<{ id: string; version: number }>;

  const admin = getAdminSupabaseClient();

  // Seed: an explicit document, else the scope's active version, else built-in.
  let document = input.document;
  let parentId: string | null = null;
  if (!document) {
    const base = admin
      .from("workflow_policy_version")
      .select("id, document")
      .eq("status", "ACTIVE");
    const { data: active } = await (ctx.scope.tenantId === null
      ? base.is("tenant_id", null)
      : base.eq("tenant_id", ctx.scope.tenantId)
    ).maybeSingle();

    if (active) {
      document = active.document as WorkflowPolicyDocument;
      parentId = active.id as string;
    } else {
      document = buildPlatformDefaultPolicy();
    }
  }

  const hash = policyContentSha256(document);

  // Duplicate detection — an identical draft in this scope is not a new policy.
  const dupQuery = admin
    .from("workflow_policy_version")
    .select("id")
    .eq("content_sha256", hash)
    .in("status", ["DRAFT", "VALIDATED", "ACTIVE"]);
  const { data: dup } = await (ctx.scope.tenantId === null
    ? dupQuery.is("tenant_id", null)
    : dupQuery.eq("tenant_id", ctx.scope.tenantId)
  ).maybeSingle();
  if (dup) {
    return fail("duplicate_content") as PolicyActionResult<{ id: string; version: number }>;
  }

  // Next version number for the scope.
  const maxQuery = admin
    .from("workflow_policy_version")
    .select("version")
    .order("version", { ascending: false })
    .limit(1);
  const { data: latest } = await (ctx.scope.tenantId === null
    ? maxQuery.is("tenant_id", null)
    : maxQuery.eq("tenant_id", ctx.scope.tenantId)
  ).maybeSingle();
  const version = ((latest?.version as number | undefined) ?? 0) + 1;

  const { data: created, error } = await admin
    .from("workflow_policy_version")
    .insert({
      tenant_id: ctx.scope.tenantId,
      version,
      policy_schema_version: POLICY_SCHEMA_VERSION,
      status: "DRAFT",
      document,
      content_sha256: hash,
      validation_status: "PENDING",
      parent_version_id: parentId,
      created_by: ctx.actorId,
    })
    .select("id")
    .single();
  if (error || !created) {
    return fail("invalid_input") as PolicyActionResult<{ id: string; version: number }>;
  }

  await writeAudit({
    action: AuditActions.WORKFLOW_POLICY_DRAFT_CREATED,
    actorId: ctx.actorId,
    tenantId: ctx.scope.tenantId,
    entity: "workflow_policy_version",
    entityId: created.id,
    after: { version, scope: ctx.scope.tenantId === null ? "platform" : "tenant", content_sha256: hash },
  });
  revalidate();
  return { ok: true, id: created.id, version };
}

// =================================================================== validate ==

/**
 * Validate a draft against the live catalogs. Deterministic and FAIL-CLOSED:
 * only a PASSED draft may ever be activated. A failure records the errors and
 * writes a FAILED audit — never a success row.
 */
export async function validatePolicyDraft(
  versionId: string,
): Promise<PolicyActionResult<{ id: string; errors: unknown[] }>> {
  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("workflow_policy_version")
    .select("id, tenant_id, status, document, policy_schema_version")
    .eq("id", versionId)
    .maybeSingle();
  if (!row) return fail("not_found") as PolicyActionResult<{ id: string; errors: unknown[] }>;

  const ctx = await guard(row.tenant_id === null);
  if (isErr(ctx)) return fail(ctx) as PolicyActionResult<{ id: string; errors: unknown[] }>;
  // A tenant manager may only touch their own tenant's versions.
  if (row.tenant_id !== null && row.tenant_id !== ctx.tenantId) {
    return fail("forbidden") as PolicyActionResult<{ id: string; errors: unknown[] }>;
  }
  if (isPublished(row.status as PolicyStatus)) {
    return fail("invalid_state") as PolicyActionResult<{ id: string; errors: unknown[] }>;
  }

  const result = validatePolicyDocument(row.document, await loadCatalogs(row.tenant_id));
  const now = new Date().toISOString();

  await admin
    .from("workflow_policy_version")
    .update({
      status: result.ok ? "VALIDATED" : "DRAFT",
      validation_status: result.ok ? "PASSED" : "FAILED",
      validation_errors: result.ok ? null : result.errors,
      validated_at: now,
      validated_by: ctx.actorId,
    })
    .eq("id", versionId);

  await writeAudit({
    action: result.ok
      ? AuditActions.WORKFLOW_POLICY_VALIDATION_PASSED
      : AuditActions.WORKFLOW_POLICY_VALIDATION_FAILED,
    actorId: ctx.actorId,
    tenantId: row.tenant_id,
    entity: "workflow_policy_version",
    entityId: versionId,
    after: { passed: result.ok, error_count: result.errors.length },
  });
  revalidate();

  return result.ok
    ? { ok: true, id: versionId, errors: [] }
    : (fail("validation_failed", result.errors) as PolicyActionResult<{ id: string; errors: unknown[] }>);
}

// =================================================================== activate ==

/**
 * Activate a VALIDATED version. Atomic through the RPC: the previous active
 * version is retired and this one promoted in one transaction.
 */
export async function activatePolicyVersion(
  versionId: string,
  reason: string,
): Promise<PolicyActionResult> {
  if (!reason || reason.trim().length === 0) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("workflow_policy_version")
    .select("id, tenant_id, version, status, validation_status")
    .eq("id", versionId)
    .maybeSingle();
  if (!row) return fail("not_found");

  const ctx = await guard(row.tenant_id === null);
  if (isErr(ctx)) return fail(ctx);
  if (row.tenant_id !== null && row.tenant_id !== ctx.tenantId) return fail("forbidden");
  if (row.status !== "VALIDATED" || row.validation_status !== "PASSED") return fail("invalid_state");

  const { error } = await admin.rpc("activate_workflow_policy", {
    p_version_id: versionId,
    p_actor: ctx.actorId,
    p_reason: reason.trim(),
    p_schema_version: POLICY_SCHEMA_VERSION,
  });
  // The RPC is the authority; a refusal is never overridden here.
  if (error) return fail("activation_failed");

  await writeAudit({
    action: AuditActions.WORKFLOW_POLICY_ACTIVATED,
    actorId: ctx.actorId,
    tenantId: row.tenant_id,
    entity: "workflow_policy_version",
    entityId: versionId,
    after: { version: row.version, scope: row.tenant_id === null ? "platform" : "tenant" },
  });
  revalidate();
  return { ok: true, id: versionId };
}

// ====================================================== dossier policy migration ==

/**
 * Move ONE dossier onto a different policy version. Deliberately narrow (WES-7C:
 * "do not implement an unrestricted migration UI"): a single dossier, an
 * explicit target, a mandatory reason, fully audited, and the target must be an
 * ACTIVE version of a scope the dossier belongs to.
 */
export async function migrateDossierPolicy(
  processInstanceId: string,
  targetVersionId: string,
  reason: string,
): Promise<PolicyActionResult> {
  if (!reason || reason.trim().length === 0) return fail("reason_required");
  const ctx = await guard(false);
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();
  const { data: instance } = await admin
    .from("process_instance")
    .select("id, tenant_id, policy_version_id")
    .eq("id", processInstanceId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!instance) return fail("not_found");

  const { data: target } = await admin
    .from("workflow_policy_version")
    .select("id, tenant_id, status, policy_schema_version")
    .eq("id", targetVersionId)
    .maybeSingle();
  if (!target) return fail("not_found");
  // Compatibility validation: only an ACTIVE version of this tenant's scope (or
  // the platform default) on the platform's current schema may be adopted.
  if (target.status !== "ACTIVE") return fail("invalid_state");
  if (target.tenant_id !== null && target.tenant_id !== ctx.tenantId) return fail("forbidden");
  if (target.policy_schema_version !== POLICY_SCHEMA_VERSION) return fail("invalid_state");

  await admin
    .from("process_instance")
    .update({ policy_version_id: targetVersionId, policy_provenance: "MIGRATED" })
    .eq("id", processInstanceId)
    .eq("tenant_id", ctx.tenantId);

  await writeAudit({
    action: AuditActions.WORKFLOW_POLICY_DOSSIER_MIGRATED,
    actorId: ctx.actorId,
    tenantId: ctx.tenantId,
    entity: "process_instance",
    entityId: processInstanceId,
    before: { policy_version_id: instance.policy_version_id },
    after: { policy_version_id: targetVersionId, provenance: "MIGRATED" },
    overrideReason: reason.trim(),
  });
  return { ok: true, id: processInstanceId };
}
