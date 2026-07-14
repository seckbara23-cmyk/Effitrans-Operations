/**
 * Process engine — read service (Phase 5.0B). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * The single read entry point for a dossier's official process state, plus the
 * admin-only compatibility DRY-RUN report.
 *
 * Nothing here mutates. Nothing here initializes an instance as a side effect —
 * with the flag off, or with no instance, it simply returns null and every
 * existing page behaves exactly as it did before Phase 5.0B.
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { COMPATIBILITY_VERSION, planCompatibilityInit, type CompatibilityPlan } from "./init";
import { buildReadModel, type ProcessReadModel } from "./read-model";
import { loadProcessSnapshot } from "./snapshot";

/**
 * The consolidated process state for one dossier (Deliverable 11).
 * Returns null when the engine is dark, the dossier is invisible, or no instance
 * exists — the caller renders nothing and the legacy UI is untouched.
 */
export async function getProcessState(fileId: string): Promise<ProcessReadModel | null> {
  if (!globalKillSwitch().enabled) return null;

  let user;
  try {
    user = await assertPermission("process:read");
  } catch {
    return null;
  }
  if (!(await getTenantProcessFlags(user.tenantId)).enabled) return null;
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const permissions = await getEffectivePermissions(user.id);
  const snap = await loadProcessSnapshot(user.tenantId, fileId, permissions);
  if (!snap?.instance) return null;

  return buildReadModel(snap.instance, snap.executions, snap.handoffs, snap.evidence);
}

export type CompatibilityReport = {
  fileId: string;
  fileNumber: string;
  fileStatus: string;
  plan: CompatibilityPlan;
};

/**
 * ADMIN-ONLY DRY RUN. Shows exactly where each legacy dossier would land, and how
 * many of its steps would be UNVERIFIED_HISTORICAL — WITHOUT writing anything.
 *
 * No production backfill may run until the live status distribution has been
 * reviewed against this report. It is deliberately read-only: there is no
 * "apply" counterpart in Phase 5.0B.
 */
export async function getCompatibilityDryRun(limit = 50): Promise<CompatibilityReport[]> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.compatibility) return [];

  let user;
  try {
    user = await assertPermission("process:manage");
  } catch {
    return [];
  }
  // Compatibility mapping is environment-gated AND tenant-gated: a dry run against a
  // tenant that is not on the engine would report a migration nobody asked for.
  if (!(await getTenantProcessFlags(user.tenantId)).compatibility) return [];

  const admin = getAdminSupabaseClient();
  const { data: files } = await scopedFrom(admin, "operational_file", user.tenantId)
    .select("id, file_number, type, status")
    .limit(limit);

  const permissions = await getEffectivePermissions(user.id);
  const out: CompatibilityReport[] = [];

  for (const f of (files ?? []) as Record<string, unknown>[]) {
    const fileId = f.id as string;
    const snap = await loadProcessSnapshot(user.tenantId, fileId, permissions);
    if (!snap) continue;
    // Already under the engine — nothing to map.
    if (snap.instance) continue;

    const plan = planCompatibilityInit(user.tenantId, "dry-run", {
      fileStatus: f.status as string,
      fileType: f.type as string,
      customs: snap.evidence.customs
        ? { status: snap.evidence.customs.status, required: snap.evidence.customs.required }
        : null,
      transport: snap.evidence.transport ? { status: snap.evidence.transport.status } : null,
      invoices: snap.evidence.invoices,
      podApproved: snap.evidence.documents.some(
        (d) => d.typeCode === "DELIVERY_NOTE" && d.status === "APPROVED",
      ),
    });

    out.push({
      fileId,
      fileNumber: f.file_number as string,
      fileStatus: f.status as string,
      plan: { ...plan, executions: [] }, // the report never ships 29 rows per dossier
    });
  }

  return out;
}

export { COMPATIBILITY_VERSION };
