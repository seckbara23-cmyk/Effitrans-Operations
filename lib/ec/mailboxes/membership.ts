import "server-only";

/**
 * EMP-4A — mailbox membership, read side. SERVER-ONLY.
 *
 * Reads through the admin client behind an application gate, because the
 * administration surface must show membership for OTHER users and the RLS
 * policy on `ec_mailbox_member` deliberately limits an ordinary session to its
 * own rows. The gate is `communication:membership:manage`, which is exactly the
 * permission the policy would have admitted anyway — the application is not
 * reaching past the boundary, it is standing where the boundary already is.
 *
 * REVOKED MEMBERSHIPS ARE READ, NOT HIDDEN. "Who had access in March" is a
 * question this table exists to answer, so history is returned and labelled
 * rather than filtered away.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { LifecycleFacts } from "./lifecycle";

export type MailboxMember = {
  id: string;
  mailboxId: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  canRead: boolean;
  canSend: boolean;
  canManageMembers: boolean;
  isDefaultSender: boolean;
  grantedAt: string;
  grantedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type MailboxSummary = {
  id: string;
  address: string;
  labelFr: string;
  /** EMP-5E — DISPLAY ONLY. Free tenant vocabulary; decides nothing about who
   *  is proposed. See `departmentEligibility` for that. */
  purpose: string;
  /** EMP-5E — the controlled eligibility key. NULL = manual assignment only. */
  departmentEligibility: string | null;
  mailboxType: string;
  provisioningStatus: string;
  provisioningNote: string | null;
  provisioningAttempts: number;
  ownerUserId: string | null;
  activeMembers: number;
  /** EMP-5C evidence, carried so readiness can be assessed without re-reading. */
  isActive: boolean;
  ownership: string;
  corporateIdentityConfirmedAt: string | null;
  outboundVerifiedAt: string | null;
  inboundVerifiedAt: string | null;
  /** EMP-5C — the checkable pointers behind the capability claims. */
  externalProvider: string | null;
  externalMailboxId: string | null;
  outboundVerificationRef: string | null;
  inboundVerificationRef: string | null;
  corporateIdentityConfirmedBy: string | null;
  /** EMP-5F accountability. NULL until migration 20260819000001 is applied,
   *  which reads as "activator unknown" — the safe direction. */
  activatedAt: string | null;
  activatedBy: string | null;
  verificationSubmittedAt: string | null;
  verificationSubmittedBy: string | null;
  outboundVerifiedBy: string | null;
  inboundVerifiedBy: string | null;
};

const MEMBER_SELECT =
  "id, mailbox_id, user_id, can_read, can_send, can_manage_members, is_default_sender, " +
  "granted_at, granted_by, revoked_at, revoke_reason, app_user!ec_mailbox_member_user_id_fkey(name, email)";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toMember(r: any): MailboxMember {
  const u = Array.isArray(r.app_user) ? r.app_user[0] : r.app_user;
  return {
    id: r.id, mailboxId: r.mailbox_id, userId: r.user_id,
    userName: u?.name ?? null, userEmail: u?.email ?? "",
    canRead: Boolean(r.can_read), canSend: Boolean(r.can_send),
    canManageMembers: Boolean(r.can_manage_members),
    isDefaultSender: Boolean(r.is_default_sender),
    grantedAt: r.granted_at, grantedBy: r.granted_by ?? null,
    revokedAt: r.revoked_at ?? null, revokeReason: r.revoke_reason ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Every mailbox in the tenant with its lifecycle state and active member count. */
export async function listMailboxSummaries(tenantId: string): Promise<MailboxSummary[]> {
  const admin = getAdminSupabaseClient();

  const [{ data: boxes }, { data: members }] = await Promise.all([
    admin
      .from("ec_mailbox")
      .select(
        "id, address, label_fr, purpose, department_eligibility, mailbox_type, "
        + "provisioning_status, provisioning_note, provisioning_attempts, owner_user_id, "
        + "is_active, ownership, corporate_identity_confirmed_at, corporate_identity_confirmed_by, "
        + "external_provider, external_mailbox_id, "
        + "outbound_verified_at, outbound_verification_ref, "
        + "inbound_verified_at, inbound_verification_ref",
      )
      .eq("tenant_id", tenantId)
      .order("address"),
    admin
      .from("ec_mailbox_member")
      .select("mailbox_id")
      .eq("tenant_id", tenantId)
      .is("revoked_at", null),
  ]);

  const counts = new Map<string, number>();
  for (const m of (members ?? []) as unknown as { mailbox_id: string }[]) {
    counts.set(m.mailbox_id, (counts.get(m.mailbox_id) ?? 0) + 1);
  }

  // EMP-5F — the accountability columns arrive with migration 20260819000001.
  // Read them SEPARATELY and fail open, so this surface works identically
  // before and after the migration is applied. Absent values read as "we do not
  // know who did this", which makes an ACTIVE mailbox look LEGACY-UNVERIFIED —
  // the safe direction, and true until the evidence exists.
  type Accountability = {
    id: string; activated_at: string | null; activated_by: string | null;
    verification_submitted_at: string | null; verification_submitted_by: string | null;
    outbound_verified_by: string | null; inbound_verified_by: string | null;
  };
  const accountability = new Map<string, Accountability>();
  try {
    const { data } = await admin
      .from("ec_mailbox")
      .select("id, activated_at, activated_by, verification_submitted_at, "
              + "verification_submitted_by, outbound_verified_by, inbound_verified_by")
      .eq("tenant_id", tenantId);
    for (const r of (data ?? []) as unknown as Accountability[]) accountability.set(r.id, r);
  } catch {
    /* migration not applied yet — every mailbox stays "accountability unknown" */
  }

  return ((boxes ?? []) as unknown as Record<string, unknown>[]).map((b) => ({
    id: b.id as string,
    address: b.address as string,
    labelFr: b.label_fr as string,
    purpose: b.purpose as string,
    departmentEligibility: (b.department_eligibility as string | null) ?? null,
    mailboxType: b.mailbox_type as string,
    provisioningStatus: b.provisioning_status as string,
    provisioningNote: (b.provisioning_note as string | null) ?? null,
    provisioningAttempts: Number(b.provisioning_attempts ?? 0),
    ownerUserId: (b.owner_user_id as string | null) ?? null,
    activeMembers: counts.get(b.id as string) ?? 0,
    isActive: Boolean(b.is_active),
    ownership: (b.ownership as string | null) ?? "UNKNOWN",
    corporateIdentityConfirmedAt: (b.corporate_identity_confirmed_at as string | null) ?? null,
    corporateIdentityConfirmedBy: (b.corporate_identity_confirmed_by as string | null) ?? null,
    externalProvider: (b.external_provider as string | null) ?? null,
    externalMailboxId: (b.external_mailbox_id as string | null) ?? null,
    outboundVerifiedAt: (b.outbound_verified_at as string | null) ?? null,
    outboundVerificationRef: (b.outbound_verification_ref as string | null) ?? null,
    inboundVerifiedAt: (b.inbound_verified_at as string | null) ?? null,
    inboundVerificationRef: (b.inbound_verification_ref as string | null) ?? null,
    activatedAt: accountability.get(b.id as string)?.activated_at ?? null,
    activatedBy: accountability.get(b.id as string)?.activated_by ?? null,
    verificationSubmittedAt: accountability.get(b.id as string)?.verification_submitted_at ?? null,
    verificationSubmittedBy: accountability.get(b.id as string)?.verification_submitted_by ?? null,
    outboundVerifiedBy: accountability.get(b.id as string)?.outbound_verified_by ?? null,
    inboundVerifiedBy: accountability.get(b.id as string)?.inbound_verified_by ?? null,
  }));
}

/**
 * EMP-5F — a summary, viewed as lifecycle facts.
 *
 * One mapping, so a surface cannot accidentally judge a mailbox on a subset of
 * its evidence: everything the guard reads comes from here, and a field this
 * function forgets is a field no caller can compensate for.
 *
 * `tenantId` is supplied by the caller because the summary list is already
 * tenant-scoped and carrying the value per row would invite it being trusted.
 */
export function lifecycleFacts(m: MailboxSummary, tenantId: string): LifecycleFacts {
  return {
    id: m.id,
    tenantId,
    address: m.address,
    mailboxType: m.mailboxType,
    ownerUserId: m.ownerUserId,
    provisioningStatus: m.provisioningStatus,
    provisioningNote: m.provisioningNote,
    ownership: m.ownership,
    externalProvider: m.externalProvider,
    externalMailboxId: m.externalMailboxId,
    corporateIdentityConfirmedAt: m.corporateIdentityConfirmedAt,
    corporateIdentityConfirmedBy: m.corporateIdentityConfirmedBy,
    outboundVerifiedAt: m.outboundVerifiedAt,
    outboundVerifiedBy: m.outboundVerifiedBy,
    outboundVerificationRef: m.outboundVerificationRef,
    inboundVerifiedAt: m.inboundVerifiedAt,
    inboundVerifiedBy: m.inboundVerifiedBy,
    inboundVerificationRef: m.inboundVerificationRef,
    activatedAt: m.activatedAt,
    activatedBy: m.activatedBy,
  };
}

/**
 * EMP-5H — how many ACTIVE people in this tenant may administer mailboxes.
 *
 * Maker-checker needs two distinct holders of `communication:mailbox:provision`:
 * one records the verification, another puts the mailbox into service. This
 * counts them so the surface can say whether that is possible at all, rather
 * than leaving an administrator to discover it when activation refuses.
 *
 * Counts DISTINCT users, because one person holding the permission through two
 * roles is still one person — and a separation of duties satisfied by counting
 * role rows instead of people would be no separation at all.
 *
 * Fail-closed: any read failure returns 0, which reads as "no checker
 * available" rather than as permission to proceed.
 */
export async function countProvisioningAdministrators(tenantId: string): Promise<number> {
  const admin = getAdminSupabaseClient();

  const { data: perm } = await admin
    .from("permission").select("id").eq("code", "communication:mailbox:provision").maybeSingle();
  if (!perm) return 0;

  const { data: rolePerms } = await admin
    .from("role_permission").select("role_id")
    .eq("permission_id", (perm as { id: string }).id);
  const roleIds = ((rolePerms ?? []) as unknown as { role_id: string }[]).map((r) => r.role_id);
  if (roleIds.length === 0) return 0;

  const { data: holders } = await admin
    .from("user_role").select("user_id, app_user!inner(status)")
    .eq("tenant_id", tenantId)
    .in("role_id", roleIds);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const distinct = new Set(
    ((holders ?? []) as any[])
      .filter((h) => {
        const u = Array.isArray(h.app_user) ? h.app_user[0] : h.app_user;
        return u?.status === "active";
      })
      .map((h) => h.user_id as string),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return distinct.size;
}

/**
 * EMP-5H.1 — the latest recorded legacy governance decision per mailbox, read
 * FROM THE AUDIT TRAIL (the one place recordLegacyActiveDecision persists to;
 * no second decision table exists, deliberately). Display-only: any read
 * failure yields an empty map, and NOTHING in the lifecycle or readiness model
 * consumes this — a visible decision changes no state.
 */
export type LegacyDecisionRecord = {
  decision: string;
  reason: string;
  occurredAt: string;
  actorEmail: string | null;
};

export async function latestLegacyDecisions(
  tenantId: string,
  mailboxIds: string[],
): Promise<Record<string, LegacyDecisionRecord>> {
  if (mailboxIds.length === 0) return {};
  const admin = getAdminSupabaseClient();

  const { data, error } = await admin
    .from("audit_log")
    .select("entity_id, occurred_at, actor_id, after")
    .eq("tenant_id", tenantId)
    .eq("action", "ec.mailbox.legacy_decision")
    .eq("entity", "ec_mailbox")
    .in("entity_id", mailboxIds)
    .order("occurred_at", { ascending: false });
  if (error || !data) return {};

  const latest: Record<string, { occurred_at: string; actor_id: string | null; after: unknown }> = {};
  for (const row of data as { entity_id: string | null; occurred_at: string; actor_id: string | null; after: unknown }[]) {
    if (row.entity_id && !latest[row.entity_id]) latest[row.entity_id] = row;
  }

  const actorIds = [...new Set(Object.values(latest).map((r) => r.actor_id).filter(Boolean))] as string[];
  const emails = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await admin
      .from("app_user")
      .select("id, email")
      .eq("tenant_id", tenantId)
      .in("id", actorIds);
    for (const a of actors ?? []) emails.set(a.id, a.email);
  }

  const out: Record<string, LegacyDecisionRecord> = {};
  for (const [mailboxId, row] of Object.entries(latest)) {
    const after = (row.after ?? {}) as { decision?: unknown; reason?: unknown };
    if (typeof after.decision !== "string") continue;
    out[mailboxId] = {
      decision: after.decision,
      reason: typeof after.reason === "string" ? after.reason : "",
      occurredAt: row.occurred_at,
      actorEmail: row.actor_id ? emails.get(row.actor_id) ?? null : null,
    };
  }
  return out;
}

/** Members of one mailbox, revoked rows included and labelled. */
export async function listMailboxMembers(
  tenantId: string,
  mailboxId: string,
): Promise<MailboxMember[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_mailbox_member")
    .select(MEMBER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("mailbox_id", mailboxId)
    .order("granted_at", { ascending: false });
  return ((data ?? []) as unknown as unknown[]).map(toMember);
}

/** Every mailbox one user belongs to — the per-user administration view. */
export async function listUserMemberships(
  tenantId: string,
  userId: string,
): Promise<(MailboxMember & { address: string; labelFr: string })[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_mailbox_member")
    .select(`${MEMBER_SELECT}, ec_mailbox!inner(address, label_fr)`)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("granted_at", { ascending: false });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data ?? []) as any[]).map((r) => {
    const mb = Array.isArray(r.ec_mailbox) ? r.ec_mailbox[0] : r.ec_mailbox;
    return { ...toMember(r), address: mb?.address ?? "", labelFr: mb?.label_fr ?? "" };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
