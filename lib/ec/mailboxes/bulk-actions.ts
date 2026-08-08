"use server";

/**
 * EMP-4A — bulk mailbox assignment. Preview first, always.
 *
 * `previewBulkAssignmentAction` performs NO write of any kind. It reads, hands
 * the data to the pure classifier, and returns a decision per user. Nothing
 * else in this module can be reached without a preview: `executeBulkAssignment`
 * requires the fingerprint of the preview it was shown, recomputes the decisions
 * server-side, and refuses if they no longer match.
 *
 * That is what makes "no direct execute without preview" a property rather than
 * a UI convention — a caller cannot skip the preview, because the token it must
 * present can only come from one.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import {
  previewBulkAssignment, previewFingerprint, writableDecisions,
  type BulkCandidate, type BulkCapabilities, type BulkDecision,
} from "./bulk";

export type PreviewResult =
  | { ok: true; decisions: BulkDecision[]; fingerprint: string; mailboxAddress: string }
  | { ok: false; error: string };

export type ExecuteResult =
  | { ok: true; applied: BulkDecision[]; batchId: string }
  | { ok: false; error: string };

const PATH = "/users/enterprise-mail";

async function gate() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:membership:manage")) return null;
  return user;
}

/** Read every candidate the classifier needs. No writes. */
async function loadCandidates(
  tenantId: string,
  mailboxId: string,
  userIds: string[] | null,
): Promise<BulkCandidate[]> {
  const admin = getAdminSupabaseClient();

  // ALWAYS tenant-scoped. An earlier draft skipped the filter for explicit ids
  // so a cross-tenant selection would surface as REJECTED rather than vanish —
  // but the platform's tenant-scope guard is right that a service-role read must
  // never be unscoped, and the UI offers no cross-tenant picker to make the
  // trade worthwhile. A foreign id therefore yields no candidate at all, and the
  // classifier's REJECTED_CROSS_TENANT stays as defence in depth for any
  // candidate that ever reaches it carrying another tenant.
  let q = admin
    .from("app_user")
    .select("id, name, email, tenant_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (userIds && userIds.length > 0) q = q.in("id", userIds);
  const { data: users } = await q;

  const ids = ((users ?? []) as unknown as { id: string }[]).map((u) => u.id);
  if (ids.length === 0) return [];

  const [{ data: roles }, { data: members }, { data: defaults }] = await Promise.all([
    admin.from("user_role").select("user_id, role:role_id(code)")
      .eq("tenant_id", tenantId).in("user_id", ids),
    admin.from("ec_mailbox_member")
      .select("id, user_id, can_read, can_send, can_manage_members, is_default_sender, revoked_at")
      .eq("tenant_id", tenantId).eq("mailbox_id", mailboxId).in("user_id", ids),
    admin.from("ec_mailbox_member")
      .select("user_id, mailbox_id")
      .eq("tenant_id", tenantId)
      .eq("is_default_sender", true).is("revoked_at", null).in("user_id", ids),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const roleMap = new Map<string, string[]>();
  for (const r of (roles ?? []) as any[]) {
    const code = Array.isArray(r.role) ? r.role[0]?.code : r.role?.code;
    if (!code) continue;
    roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), code]);
  }
  const memberMap = new Map<string, BulkCandidate["existing"]>();
  for (const m of (members ?? []) as any[]) {
    memberMap.set(m.user_id, {
      id: m.id, canRead: m.can_read, canSend: m.can_send,
      canManageMembers: m.can_manage_members, isDefaultSender: m.is_default_sender,
      revokedAt: m.revoked_at ?? null,
    });
  }
  const otherDefault = new Set(
    ((defaults ?? []) as any[]).filter((d) => d.mailbox_id !== mailboxId).map((d) => d.user_id),
  );

  return ((users ?? []) as any[]).map((u) => ({
    userId: u.id, name: u.name ?? null, email: u.email, tenantId: u.tenant_id,
    roleCodes: roleMap.get(u.id) ?? [],
    existing: memberMap.get(u.id) ?? null,
    hasOtherDefaultSender: otherDefault.has(u.id),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** THE PREVIEW. Reads only. */
export async function previewBulkAssignmentAction(input: {
  mailboxId: string;
  userIds?: string[] | null;
  capabilities: BulkCapabilities;
  requireEligibility: boolean;
}): Promise<PreviewResult> {
  const user = await gate();
  if (!user) return { ok: false, error: "forbidden" };

  const admin = getAdminSupabaseClient();
  const { data: mailbox } = await admin
    .from("ec_mailbox").select("id, address, purpose")
    .eq("id", input.mailboxId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!mailbox) return { ok: false, error: "mailbox_not_found" };

  const candidates = await loadCandidates(user.tenantId, input.mailboxId, input.userIds ?? null);
  const decisions = previewBulkAssignment({
    tenantId: user.tenantId,
    mailboxPurpose: (mailbox as { purpose: string }).purpose,
    capabilities: input.capabilities,
    candidates,
    requireEligibility: input.requireEligibility,
  });

  return {
    ok: true,
    decisions,
    fingerprint: previewFingerprint(decisions, {
      mailboxId: input.mailboxId,
      capabilities: input.capabilities,
      requireEligibility: input.requireEligibility,
    }),
    mailboxAddress: (mailbox as { address: string }).address,
  };
}

/**
 * Execute a previewed batch.
 *
 * Idempotent by construction: it writes through the same upsert the single-user
 * grant uses, keyed on the (mailbox, user) unique index, so re-running a batch
 * re-decides every user and finds them all UNCHANGED. Running it twice changes
 * nothing the second time.
 */
export async function executeBulkAssignment(input: {
  mailboxId: string;
  userIds?: string[] | null;
  capabilities: BulkCapabilities;
  requireEligibility: boolean;
  fingerprint: string;
}): Promise<ExecuteResult> {
  const user = await gate();
  if (!user) return { ok: false, error: "forbidden" };

  // Recompute server-side. The client's decisions are never trusted — only its
  // claim about WHICH preview it saw, which we verify against our own.
  const preview = await previewBulkAssignmentAction({
    mailboxId: input.mailboxId,
    userIds: input.userIds ?? null,
    capabilities: input.capabilities,
    requireEligibility: input.requireEligibility,
  });
  if (!preview.ok) return { ok: false, error: preview.error };

  if (preview.fingerprint !== input.fingerprint) {
    // Someone changed something between preview and confirmation. Refusing is
    // the only honest option: the administrator approved a different set.
    return { ok: false, error: "preview_stale" };
  }

  const todo = writableDecisions(preview.decisions);
  const admin = getAdminSupabaseClient();
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const c = input.capabilities;

  const applied: BulkDecision[] = [];
  for (const d of todo) {
    const { data, error } = await admin
      .from("ec_mailbox_member")
      .upsert({
        tenant_id: user.tenantId,
        mailbox_id: input.mailboxId,
        user_id: d.userId,
        can_read: c.canRead,
        can_send: c.canSend,
        can_manage_members: c.canManageMembers,
        is_default_sender: c.isDefaultSender,
        granted_by: user.id,
        granted_at: now,
        // Re-activation clears the revocation on the SAME row; the history of
        // who revoked it and why is replaced by the new grant, and the audit
        // trail below keeps both events.
        revoked_at: null, revoked_by: null, revoke_reason: null,
      }, { onConflict: "mailbox_id,user_id" })
      .select("id")
      .maybeSingle();

    if (error || !data) continue; // recorded as not-applied by omission
    applied.push(d);

    // Each changed membership is audited individually, carrying the batch id so
    // the batch and its parts can be reconciled either way.
    await writeAudit({
      action: AuditActions.EC_MAILBOX_MEMBER_GRANTED,
      actorId: user.id, tenantId: user.tenantId,
      entity: "ec_mailbox_member", entityId: (data as { id: string }).id,
      after: { batch_id: batchId, outcome: d.outcome, user_id: d.userId,
               mailbox_id: input.mailboxId, ...c },
    });
  }

  // And the batch itself, so "what happened on Tuesday" has one row to find.
  await writeAudit({
    action: AuditActions.EC_MAILBOX_BULK_ASSIGNED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: input.mailboxId,
    after: {
      batch_id: batchId,
      previewed: preview.decisions.length,
      writable: todo.length,
      applied: applied.length,
      capabilities: c,
      require_eligibility: input.requireEligibility,
    },
  });

  revalidatePath(PATH);
  return { ok: true, applied, batchId };
}
