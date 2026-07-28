/**
 * TEMPORARY UAT-1 DIAGNOSTIC — DELETE AFTER USE.
 * ---------------------------------------------------------------------------
 * Answers ONE question: which exact boolean hides the IntakePanel on
 * /files/{id}/process.
 *
 * It re-evaluates the SAME expressions the page evaluates, in the same order,
 * and reports each one. It calls the real resolvers — it does not reimplement
 * them — so it cannot drift from the page it is diagnosing.
 *
 * SAFETY:
 *   * requires an authenticated session; anonymous callers get 401;
 *   * returns ONLY booleans about the CALLER's own effective state — no keys,
 *     no tokens, no UUIDs, no other users, no cross-tenant data;
 *   * read-only: it writes nothing and creates no process instance.
 *
 * Usage:  /api/diagnostics/intake?fileId=<dossier uuid>
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { getTenantProcessFlags, getTenantRollout } from "@/lib/process/rollout-server";
import { isFileVisible } from "@/lib/authz/visibility";
import { getIntakeState } from "@/lib/process/engine/intake-actions";
import { getProcessState } from "@/lib/process/engine/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const fileId = new URL(request.url).searchParams.get("fileId");

  // ---- layer 1: DEPLOYMENT env (process.env, read at runtime) -------------
  const env = getProcessFlags();

  // ---- layer 2: TENANT rollout row ---------------------------------------
  const rollout = await getTenantRollout(user.tenantId);

  // ---- layer 3: effective flags (env AND tenant) — what the page uses -----
  const tenantFlags = await getTenantProcessFlags(user.tenantId);

  // ---- layer 4: permissions ----------------------------------------------
  const permissions = await getEffectivePermissions(user.id);
  const canOpen =
    hasPermission(permissions, "process:manage") &&
    hasPermission(permissions, "process:owner:assign");

  // ---- layer 5: the two runtime reads the page performs -------------------
  // The page hides the panel when EITHER tenantFlags.intake is false OR
  // getIntakeState returns null. Both are reported separately, because they
  // fail for completely different reasons.
  let fileVisible: boolean | null = null;
  let intakeStateResolved: boolean | null = null;
  let processStateResolved: boolean | null = null;

  if (fileId) {
    fileVisible = await isFileVisible(user.id, user.tenantId, fileId);
    // Called unconditionally (unlike the page, which calls it only when the
    // flag is on) so the flag and the read are diagnosed independently.
    intakeStateResolved = (await getIntakeState(fileId)) !== null;
    processStateResolved = (await getProcessState(fileId)) !== null;
  }

  const showIntakePanel = Boolean(tenantFlags.intake && intakeStateResolved);

  return NextResponse.json({
    // === the shape requested ===
    processEngine: env.enabled,
    processStructures: env.structures,
    operationsIntake: env.intake,
    processWorkspaces: env.workspaces,
    tenantEngine: tenantFlags.enabled,
    tenantWorkspaces: tenantFlags.workspaces,
    tenantIntake: tenantFlags.intake,
    canOpen,
    showIntakePanel,

    // === discriminators: which of the six null-paths actually fired ===
    diagnostics: {
      // raw tenant row (fail-closed false when the row is missing entirely)
      rolloutRowProcessEngine: rollout.process_engine,
      rolloutRowWorkspaces: rollout.process_workspaces,

      // permissions the chain needs
      hasProcessRead: hasPermission(permissions, "process:read"),
      hasProcessManage: hasPermission(permissions, "process:manage"),
      hasOwnerAssign: hasPermission(permissions, "process:owner:assign"),
      hasFileReadAll: hasPermission(permissions, "file:read:all"),

      // THE most likely culprit once the flags are on: the page itself never
      // checks dossier visibility, but every panel's guard does — so an
      // unrelated user gets the page shell with every panel silently null.
      fileIdProvided: Boolean(fileId),
      fileVisible,
      intakeStateResolved,
      processStateResolved,

      permissionCount: permissions.length,
    },
  });
}
