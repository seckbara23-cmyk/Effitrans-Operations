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
        + "is_active, ownership, corporate_identity_confirmed_at, "
        + "outbound_verified_at, inbound_verified_at",
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
    outboundVerifiedAt: (b.outbound_verified_at as string | null) ?? null,
    inboundVerifiedAt: (b.inbound_verified_at as string | null) ?? null,
  }));
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
