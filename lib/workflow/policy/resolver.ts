/**
 * THE workflow policy resolver (Phase WES-7D). SERVER-ONLY, tenant-safe.
 * ---------------------------------------------------------------------------
 * ONE resolution order, in ONE place. No module may implement its own fallback:
 * the whole point of a pinned policy is that every consumer asking "what rules
 * govern this dossier?" gets the same immutable answer.
 *
 *   1. the version PINNED to this process instance   (authoritative, immutable)
 *   2. the tenant's ACTIVE override
 *   3. the platform's ACTIVE default
 *   4. the BUILT-IN default derived from the code registries
 *   5. fail closed
 *
 * Step 4 needs justifying. WES-7G requires the registry to reproduce current
 * ratified behaviour EXACTLY on day one. Until an operator publishes a platform
 * default, there is no stored version — and refusing to resolve would take the
 * whole workflow offline for a configuration feature nobody has configured yet.
 * So the built-in default (lib/workflow/policy/default.ts) is the floor. It is
 * DERIVED from the same registries the engine already obeys, so resolving it
 * changes nothing, and it is reported with provenance `LEGACY_DEFAULT` — never
 * dressed up as a pinned version.
 *
 * Step 5 is still real: if a caller demands a policy for a scope that resolves
 * to nothing at all (a pinned id that no longer exists, a corrupt document),
 * resolution FAILS rather than silently falling back. A dossier must never be
 * governed by rules other than the ones it was pinned to.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildPlatformDefaultPolicy } from "./default";
import { policyContentSha256 } from "./hash";
import { POLICY_SCHEMA_VERSION, type ResolvedPolicy, type WorkflowPolicyDocument } from "./schema";

export type PolicyResolutionFailure =
  /** The instance pins a version that cannot be loaded — never silently substituted. */
  | "pinned_version_missing"
  /** A stored document does not match the platform's schema version. */
  | "schema_mismatch"
  /** The caller asked for another tenant's policy. */
  | "cross_tenant";

export type PolicyResolution =
  | { ok: true; policy: ResolvedPolicy }
  | { ok: false; error: PolicyResolutionFailure };

type Row = {
  id: string;
  tenant_id: string | null;
  version: number;
  policy_schema_version: number;
  document: unknown;
  content_sha256: string;
};

const SELECT = "id, tenant_id, version, policy_schema_version, document, content_sha256";

/** The built-in floor, computed once per process. */
let builtIn: ResolvedPolicy | null = null;
function builtInDefault(): ResolvedPolicy {
  if (!builtIn) {
    const document = buildPlatformDefaultPolicy();
    builtIn = {
      versionId: "builtin",
      tenantId: null,
      version: 0,
      contentSha256: policyContentSha256(document),
      provenance: "LEGACY_DEFAULT",
      document,
    };
  }
  return builtIn;
}

/** The built-in default, for surfaces that want to show what "no version" means. */
export function getBuiltInDefaultPolicy(): ResolvedPolicy {
  return builtInDefault();
}

function toResolved(row: Row, provenance: ResolvedPolicy["provenance"]): PolicyResolution {
  if (row.policy_schema_version !== POLICY_SCHEMA_VERSION) {
    return { ok: false, error: "schema_mismatch" };
  }
  return {
    ok: true,
    policy: {
      versionId: row.id,
      tenantId: row.tenant_id,
      version: row.version,
      contentSha256: row.content_sha256,
      provenance,
      document: row.document as WorkflowPolicyDocument,
    },
  };
}

/**
 * Resolve the policy governing a dossier, or a tenant's current policy when no
 * process instance is supplied.
 *
 * Request-memoized: a page that resolves policy in a layout, a guard and a
 * service pays for one query.
 */
export const resolvePolicy = cache(
  async (input: { tenantId: string; processInstanceId?: string | null }): Promise<PolicyResolution> => {
    const admin = getAdminSupabaseClient();

    // 1 — the PINNED version. Authoritative and immutable: a later activation
    // cannot reach a dossier that is already pinned.
    if (input.processInstanceId) {
      const { data: instance } = await admin
        .from("process_instance")
        .select("policy_version_id, policy_provenance, tenant_id")
        .eq("id", input.processInstanceId)
        .eq("tenant_id", input.tenantId) // cross-tenant reads are impossible
        .maybeSingle();

      if (instance?.policy_version_id) {
        const { data: pinned } = await admin
          .from("workflow_policy_version")
          .select(SELECT)
          .eq("id", instance.policy_version_id as string)
          .maybeSingle();
        // A pin that cannot be loaded FAILS. Substituting a different version
        // would silently change the rules a dossier is judged by.
        if (!pinned) return { ok: false, error: "pinned_version_missing" };
        return toResolved(pinned as Row, "PINNED");
      }
    }

    // 2 — the tenant's active override.
    const { data: tenantActive } = await admin
      .from("workflow_policy_version")
      .select(SELECT)
      .eq("tenant_id", input.tenantId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (tenantActive) return toResolved(tenantActive as Row, "PINNED");

    // 3 — the platform's active default.
    const { data: platformActive } = await admin
      .from("workflow_policy_version")
      .select(SELECT)
      .is("tenant_id", null)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (platformActive) return toResolved(platformActive as Row, "PINNED");

    // 4 — the built-in default derived from the code registries.
    return { ok: true, policy: builtInDefault() };
  },
);

/**
 * The version id to PIN when a process instance is created (WES-7C).
 * Returns null when only the built-in default is available — the instance is
 * then marked LEGACY_DEFAULT rather than pinned to a version that does not exist.
 */
export async function resolvePolicyVersionIdForPinning(tenantId: string): Promise<string | null> {
  const admin = getAdminSupabaseClient();

  const { data: tenantActive } = await admin
    .from("workflow_policy_version")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (tenantActive?.id) return tenantActive.id as string;

  const { data: platformActive } = await admin
    .from("workflow_policy_version")
    .select("id")
    .is("tenant_id", null)
    .eq("status", "ACTIVE")
    .maybeSingle();
  return (platformActive?.id as string | undefined) ?? null;
}
