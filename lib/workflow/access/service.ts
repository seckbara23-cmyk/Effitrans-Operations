/**
 * Dossier access, assembled (Phase WES-3D). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gathers what the PURE resolver needs and calls it. All judgement lives in
 * `resolver.ts`; this file only fetches. Keeping the split means every rule in
 * the WES-3C matrix is testable without a database.
 *
 * Request-memoized: a dossier page asks several times per render, and the
 * answer cannot change mid-request.
 */
import { missingDocumentationEvidence } from "@/lib/documents/requirements";
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import { resolveSupervisorRoles } from "./eligibility";
import { resolveDossierAccess, type DossierAccess } from "./resolver";
import type { Department } from "@/lib/files/lifecycle";

export type AssignmentHistoryRow = {
  id: string;
  subjectType: string;
  subjectId: string;
  previousUserId: string | null;
  newUserId: string | null;
  actorUserId: string | null;
  reasonCode: string | null;
  reason: string | null;
  workflowStepKey: string | null;
  provenance: string;
  createdAt: string;
};

/**
 * Everything WES-3 says about one user and one dossier.
 * Returns null when the dossier does not exist or is another tenant's.
 */
export const getDossierAccess = cache(
  async (fileId: string): Promise<DossierAccess | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = getAdminSupabaseClient();

    const { data: file } = await supabase
      .from("operational_file")
      .select("id, tenant_id, account_manager_id, coordinator_id, status, type")
      .eq("id", fileId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{
        id: string;
        tenant_id: string;
        account_manager_id: string | null;
        coordinator_id: string | null;
        status: string;
        type: string;
      }>();
    if (!file) return null;

    const { data: instance } = await supabase
      .from("process_instance")
      .select("id, owner_user_id")
      .eq("file_id", fileId)
      .eq("tenant_id", user.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; owner_user_id: string | null }>();

    // WHERE THE DOSSIER IS — from the WES-2 canonical projection. Never
    // recomputed here; WES-2 owns that formula and this phase does not touch it.
    //
    // Every input is read for real. `missingRequired` in particular feeds
    // `docsVerified`, which moves the responsible department, which decides
    // access — approximating it as empty would silently advance the department
    // and hand out authority nobody granted.
    // `getMissingRequiredDocuments` is deliberately NOT reused: it asserts
    // `document:read` and file visibility, and returns [] when either is
    // missing. Calling it from here would be circular AND unsafe — a user
    // without document:read would see "nothing missing", which marks the
    // documentation stage verified, advances the responsible department, and
    // hands out authority nobody granted. The derivation itself needs no
    // permission, so it is done directly on the admin client.
    const [docs, docTypes, customs, transport, invoices] = await Promise.all([
      supabase.from("document").select("type_code, status").eq("file_id", fileId)
        .eq("tenant_id", user.tenantId).is("deleted_at", null),
      supabase.from("document_type").select("code, label_fr")
        .eq("active", true).contains("required_for", [file.type]),
      supabase.from("customs_record").select("status, required").eq("file_id", fileId)
        .eq("tenant_id", user.tenantId).maybeSingle<{ status: string; required: boolean }>(),
      supabase.from("transport_record").select("status").eq("file_id", fileId)
        .eq("tenant_id", user.tenantId).maybeSingle<{ status: string }>(),
      supabase.from("invoice").select("status").eq("file_id", fileId)
        .eq("tenant_id", user.tenantId),
    ]);

    const documentRows = docs.data ?? [];
    const documents = documentRows.map((d) => ({ status: d.status as string }));
    // WES-5C — stage-aware: only documentation-stage evidence can hold the
    // documentation stage, so a missing POD no longer freezes the responsible
    // department (and therefore WES-3 access) at Documentation.
    const missing = missingDocumentationEvidence({
      fileType: file.type,
      requiredCodes: (docTypes.data ?? []).map((t) => t.code as string),
      facts: documentRows.map((d) => ({ typeCode: d.type_code as string, status: d.status as string })),
    }).map((m) => ({ label: m.label }));

    const podApproved = transport.data?.status === "POD_RECEIVED";

    const projection = buildCanonicalProjection({
      fileId,
      file: { status: file.status, type: file.type },
      documents,
      missingRequired: missing,
      customs: customs.data
        ? { status: customs.data.status, required: customs.data.required }
        : null,
      transport: transport.data ? { status: transport.data.status } : null,
      // Balance is not read: it affects finance GATE labels, not which
      // department is responsible, and reading it would need finance authority
      // this resolver must not require.
      invoices: (invoices.data ?? []).map((i) => ({ status: i.status as string, balance: 0 })),
      podApproved,
    });

    // Current work assignment.
    const { data: task } = await supabase
      .from("task")
      .select("assigned_to")
      .eq("file_id", fileId)
      .eq("tenant_id", user.tenantId)
      .in("status", ["TODO", "IN_PROGRESS"])
      .eq("assigned_to", user.id)
      .limit(1)
      .maybeSingle<{ assigned_to: string | null }>();

    const { data: step } = instance
      ? await supabase
          .from("process_step_execution")
          .select("assigned_user_id")
          .eq("process_instance_id", instance.id)
          .eq("tenant_id", user.tenantId)
          .eq("assigned_user_id", user.id)
          .limit(1)
          .maybeSingle<{ assigned_user_id: string | null }>()
      : { data: null };

    // BOUNDED history: departments this user verifiably worked in on THIS
    // dossier, read from the append-only ledger. Holding a role is not a claim
    // of having contributed.
    const { data: history } = await supabase
      .from("assignment_event")
      .select("workflow_step_key")
      .eq("file_id", fileId)
      .eq("tenant_id", user.tenantId)
      .or(`new_user_id.eq.${user.id},previous_user_id.eq.${user.id}`)
      .limit(200);

    const contributed = new Set<Department>();
    if ((history?.length ?? 0) > 0 && projection) {
      // The dossier's own past departments are the only ones a contribution can
      // have been in; each completed stage is one this user may have worked.
      for (const stage of projection.stages) {
        if (stage.state === "completed") contributed.add(stage.department);
      }
    }

    const supervisor = projection?.responsibleDepartment
      ? await resolveSupervisorRoles(
          { tenantId: user.tenantId, processInstanceId: instance?.id ?? null },
          projection.responsibleDepartment,
        )
      : { roles: [], resolved: false };

    const permissions = await getEffectivePermissions(user.id);

    return resolveDossierAccess({
      userId: user.id,
      roleCodes: user.roles,
      permissions,
      commercialOwnerId: file.account_manager_id ?? file.coordinator_id,
      operationalOwnerId: instance?.owner_user_id ?? null,
      responsibleDepartment: projection?.responsibleDepartment ?? null,
      currentStage: projection?.currentStage ?? "draft",
      currentTaskAssigneeId: task?.assigned_to ?? null,
      currentStepAssigneeId: step?.assigned_user_id ?? null,
      supervisorRoles: supervisor.roles,
      contributedFromDepartments: Array.from(contributed),
    });
  },
);

/**
 * The CANONICAL operational owner id (WES-3G), or null.
 * Deliberately not `resolveEffectiveProcessOwner`: that resolver's legacy
 * fallbacks exist for DISPLAY during the migration window, and presenting a
 * fallback as "the operational owner" is exactly the ambiguity WES-3 removes.
 */
export const getOperationalOwnerId = cache(
  async (fileId: string): Promise<string | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data } = await getAdminSupabaseClient()
      .from("process_instance")
      .select("owner_user_id")
      .eq("file_id", fileId)
      .eq("tenant_id", user.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ owner_user_id: string | null }>();
    return data?.owner_user_id ?? null;
  },
);

/** Assignment history for one dossier, newest first. RLS-adjacent: tenant-scoped. */
export async function readAssignmentHistory(
  fileId: string,
  limit = 50,
): Promise<AssignmentHistoryRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const access = await getDossierAccess(fileId);
  if (!access?.canViewSummary) return [];

  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("assignment_event")
    .select(
      "id, subject_type, subject_id, previous_user_id, new_user_id, actor_user_id, " +
        "reason_code, reason, workflow_step_key, provenance, created_at",
    )
    .eq("file_id", fileId)
    .eq("tenant_id", user.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // The free-text reason is only shown to those who may see current detail —
  // it is staff-authored commentary, not summary information.
  const showReason = access.canViewCurrentDepartmentDetail;

  const rows = (data ?? []) as unknown as Record<string, string | null>[];
  return rows.map((r) => ({
    id: r.id as string,
    subjectType: r.subject_type as string,
    subjectId: r.subject_id as string,
    previousUserId: r.previous_user_id as string | null,
    newUserId: r.new_user_id as string | null,
    actorUserId: r.actor_user_id as string | null,
    reasonCode: r.reason_code as string | null,
    reason: showReason ? ((r.reason as string | null) ?? null) : null,
    workflowStepKey: r.workflow_step_key as string | null,
    provenance: r.provenance as string,
    createdAt: r.created_at as string,
  }));
}
