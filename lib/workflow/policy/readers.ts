/**
 * Workflow policy — read side (Phase WES-7F). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * Everything the administration surface needs, and nothing more. Gated on the
 * EXISTING `admin:config:manage` and tenant-scoped on the service-role client
 * (RLS does not backstop the service role, so the tenant filter is mandatory —
 * enforced by tests/tenant-scope.test.ts).
 *
 * The policy DOCUMENT is only returned for versions the caller's scope owns or
 * the platform default they actually run on: a tenant can never read another
 * tenant's configuration.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { diffPolicies, type PolicyDiffEntry } from "./hash";
import { getBuiltInDefaultPolicy } from "./resolver";
import type { PolicyStatus, WorkflowPolicyDocument } from "./schema";

type Ctx = { userId: string; tenantId: string };

async function readGuard(): Promise<Ctx | null> {
  try {
    const user = await assertPermission("admin:config:manage");
    return { userId: user.id, tenantId: user.tenantId };
  } catch {
    return null;
  }
}

export type PolicyVersionView = {
  id: string;
  /** null ⇒ the platform default. */
  tenantId: string | null;
  scope: "platform" | "tenant";
  version: number;
  policySchemaVersion: number;
  status: PolicyStatus;
  contentSha256: string;
  validationStatus: string;
  validationErrorCount: number;
  activatedAt: string | null;
  activationReason: string | null;
  retiredAt: string | null;
  createdAt: string;
};

const LIST_COLS =
  "id, tenant_id, version, policy_schema_version, status, content_sha256, validation_status, validation_errors, activated_at, activation_reason, retired_at, created_at";

function toView(d: Record<string, unknown>): PolicyVersionView {
  const errors = d.validation_errors;
  return {
    id: d.id as string,
    tenantId: (d.tenant_id as string | null) ?? null,
    scope: d.tenant_id === null ? "platform" : "tenant",
    version: d.version as number,
    policySchemaVersion: d.policy_schema_version as number,
    status: d.status as PolicyStatus,
    contentSha256: d.content_sha256 as string,
    validationStatus: d.validation_status as string,
    validationErrorCount: Array.isArray(errors) ? errors.length : 0,
    activatedAt: (d.activated_at as string | null) ?? null,
    activationReason: (d.activation_reason as string | null) ?? null,
    retiredAt: (d.retired_at as string | null) ?? null,
    createdAt: d.created_at as string,
  };
}

/**
 * Version history for the caller's tenant PLUS the platform defaults they run
 * on. Newest first. Degrades to [] when the migration is absent.
 */
export async function listPolicyVersions(): Promise<PolicyVersionView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const [tenant, platform] = await Promise.all([
      admin
        .from("workflow_policy_version")
        .select(LIST_COLS)
        .eq("tenant_id", ctx.tenantId)
        .order("version", { ascending: false }),
      admin
        .from("workflow_policy_version")
        .select(LIST_COLS)
        .is("tenant_id", null)
        .order("version", { ascending: false }),
    ]);
    return [...(tenant.data ?? []), ...(platform.data ?? [])].map(toView);
  } catch {
    return [];
  }
}

/** The ACTIVE version governing this tenant today, or null when only the built-in default applies. */
export async function getActivePolicyVersion(): Promise<PolicyVersionView | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const admin = getAdminSupabaseClient();
  try {
    const { data: tenantActive } = await admin
      .from("workflow_policy_version")
      .select(LIST_COLS)
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (tenantActive) return toView(tenantActive);

    const { data: platformActive } = await admin
      .from("workflow_policy_version")
      .select(LIST_COLS)
      .is("tenant_id", null)
      .eq("status", "ACTIVE")
      .maybeSingle();
    return platformActive ? toView(platformActive) : null;
  } catch {
    return null;
  }
}

export type PolicyVersionDetail = PolicyVersionView & {
  document: WorkflowPolicyDocument;
  validationErrors: unknown[];
};

/** One version in full, tenant-verified. */
export async function getPolicyVersion(id: string): Promise<PolicyVersionDetail | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const admin = getAdminSupabaseClient();
  try {
    const { data } = await admin
      .from("workflow_policy_version")
      .select(`${LIST_COLS}, document`)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    // A tenant may read its own versions and the platform defaults it runs on.
    const tenantId = (data.tenant_id as string | null) ?? null;
    if (tenantId !== null && tenantId !== ctx.tenantId) return null;

    return {
      ...toView(data),
      document: data.document as WorkflowPolicyDocument,
      validationErrors: Array.isArray(data.validation_errors) ? (data.validation_errors as unknown[]) : [],
    };
  } catch {
    return null;
  }
}

/** Structural comparison of two versions the caller may read. */
export async function comparePolicyVersions(
  leftId: string,
  rightId: string,
): Promise<PolicyDiffEntry[] | null> {
  const [left, right] = await Promise.all([getPolicyVersion(leftId), getPolicyVersion(rightId)]);
  if (!left || !right) return null;
  return diffPolicies(left.document, right.document);
}

/** What "no stored version" actually resolves to — shown so the default is never a mystery. */
export async function getBuiltInDefaultSummary(): Promise<{ contentSha256: string; description: string } | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const p = getBuiltInDefaultPolicy();
  return { contentSha256: p.contentSha256, description: p.document.description };
}
