"use server";

/**
 * EMP-4A — mailbox membership and provisioning, WRITE side.
 *
 * Two authorities, kept apart because they are different jobs:
 *   `communication:membership:manage` — who may use a mailbox
 *   `communication:mailbox:provision` — which mailboxes exist and their state
 *
 * Neither is held by SYSTEM_ADMIN. Both belong to MAIL_ADMIN, which
 * deliberately does NOT hold `communication:inbound:read`: administering who
 * may read correspondence is not the same authority as reading it.
 *
 * NOTHING HERE CONTACTS A PROVIDER. "Provision" reserves an internal identity
 * and records intent; an operator creates the real mailbox out of band and
 * reports the outcome. A retry is an audited internal retry that calls nothing
 * — the platform cannot observe an external system it does not integrate with,
 * so it records what a human tells it and says so.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isDepartmentEligibility, canHoldDepartmentEligibility } from "./eligibility";

export type MailAdminResult = { ok: true; id?: string } | { ok: false; error: string };

const PATH = "/admin/enterprise-mail/mailboxes";

/** Capabilities an administrator may set. `can_send_as` does not exist (EMP-4B). */
export type Capabilities = {
  canRead?: boolean;
  canSend?: boolean;
  canManageMembers?: boolean;
  isDefaultSender?: boolean;
};

async function gate(permission: string) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, permission)) return { ok: false as const, user: null };
  return { ok: true as const, user };
}

/**
 * Grant or update membership.
 *
 * Re-granting a revoked membership updates the SAME row and clears the
 * revocation, rather than inserting a second one — the unique index on
 * (mailbox_id, user_id) makes that the only possibility, and it is the right
 * one: a person's relationship to a mailbox is one fact with a history, not a
 * pile of rows.
 */
export async function grantMembership(input: {
  mailboxId: string;
  userId: string;
  capabilities?: Capabilities;
}): Promise<MailAdminResult> {
  const g = await gate("communication:membership:manage");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  // Both sides must belong to this tenant. Checked explicitly rather than
  // trusting the caller, because a forged id is the whole threat here.
  const [{ data: mailbox }, { data: target }] = await Promise.all([
    admin.from("ec_mailbox").select("id, address").eq("id", input.mailboxId).eq("tenant_id", user.tenantId).maybeSingle(),
    admin.from("app_user").select("id, email").eq("id", input.userId).eq("tenant_id", user.tenantId).maybeSingle(),
  ]);
  if (!mailbox) return { ok: false, error: "mailbox_not_found" };
  if (!target) return { ok: false, error: "user_not_found" };

  const c = input.capabilities ?? {};
  const row = {
    tenant_id: user.tenantId,
    mailbox_id: input.mailboxId,
    user_id: input.userId,
    can_read: c.canRead ?? true,
    can_send: c.canSend ?? false,
    can_manage_members: c.canManageMembers ?? false,
    is_default_sender: c.isDefaultSender ?? false,
    granted_by: user.id,
    granted_at: new Date().toISOString(),
    // Re-granting clears the revocation; the row keeps its identity.
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
  };

  const { data, error } = await admin
    .from("ec_mailbox_member")
    .upsert(row, { onConflict: "mailbox_id,user_id" })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "grant_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_MEMBER_GRANTED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox_member", entityId: (data as { id: string }).id,
    after: { mailbox: (mailbox as { address: string }).address, user: (target as { email: string }).email, ...row,
             tenant_id: undefined, granted_by: undefined },
  });
  revalidatePath(PATH);
  return { ok: true, id: (data as { id: string }).id };
}

/** Revoke — never delete, so the history stays answerable. */
export async function revokeMembership(
  memberId: string,
  reason: string,
): Promise<MailAdminResult> {
  const g = await gate("communication:membership:manage");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const { data, error } = await admin
    .from("ec_mailbox_member")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
      revoke_reason: reason.slice(0, 400),
      // A revoked membership grants nothing, and leaving a stale default sender
      // behind would let a revoked row still decide something.
      is_default_sender: false,
    })
    .eq("id", memberId)
    .eq("tenant_id", user.tenantId)
    .is("revoked_at", null)
    .select("id, mailbox_id, user_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_revocable" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_MEMBER_REVOKED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox_member", entityId: memberId,
    after: { reason: reason.slice(0, 400), ...(data as Record<string, unknown>) },
  });
  revalidatePath(PATH);
  return { ok: true, id: memberId };
}

// ---------------------------------------------------------------------------
// Provisioning lifecycle — operator-assisted, no external call anywhere.
// ---------------------------------------------------------------------------

/**
 * Reserve an internal mailbox identity.
 *
 * It lands in PENDING_EXTERNAL_SETUP, not ACTIVE: the address exists in this
 * platform and is reserved against the global unique index, but no mailbox
 * exists at any provider yet. Routing stays off (is_active is derived from the
 * status) until a human confirms the external setup.
 */
export async function provisionMailbox(input: {
  address: string;
  labelFr: string;
  /** DISPLAY LABEL. Free tenant vocabulary; proposes nobody to anybody. */
  purpose: string;
  mailboxType: "SHARED" | "PERSONAL" | "FUNCTIONAL";
  ownerUserId?: string | null;
  /** EMP-5E — the controlled eligibility key. Omit or null for manual-only. */
  departmentEligibility?: string | null;
}): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  const address = input.address.trim().toLowerCase();
  if (!address.includes("@") || address.length < 3 || address.length > 320) {
    return { ok: false, error: "invalid_address" };
  }
  if (input.mailboxType === "PERSONAL" && !input.ownerUserId) {
    return { ok: false, error: "owner_required" };
  }
  // SHARED and FUNCTIONAL both represent something other than one person, and
  // the schema's owner-shape rule refuses an owner on either.
  if (input.mailboxType !== "PERSONAL" && input.ownerUserId) {
    return { ok: false, error: "owner_not_allowed" };
  }

  const eligibility = normalizeEligibility(input.departmentEligibility);
  if (eligibility === INVALID) return { ok: false, error: "invalid_eligibility" };
  if (eligibility && !canHoldDepartmentEligibility(input.mailboxType)) {
    return { ok: false, error: "personal_not_departmental" };
  }

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("ec_mailbox")
    .insert({
      tenant_id: user.tenantId,
      address,
      label_fr: input.labelFr.trim() || address,
      purpose: input.purpose,
      department_eligibility: eligibility,
      mailbox_type: input.mailboxType,
      owner_user_id: input.ownerUserId ?? null,
      provisioning_status: "PENDING_EXTERNAL_SETUP",
      provisioned_by: user.id,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    // The global unique index covers mailboxes AND aliases via the trigger, so
    // a collision is reported as such rather than as a generic failure.
    const taken = error?.code === "23505" || /already (a mailbox|an alias)/.test(error?.message ?? "");
    return { ok: false, error: taken ? "address_taken" : "provision_failed" };
  }

  await writeAudit({
    action: AuditActions.EC_MAILBOX_PROVISIONED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: (data as { id: string }).id,
    after: { address, mailbox_type: input.mailboxType, status: "PENDING_EXTERNAL_SETUP",
             department_eligibility: eligibility },
  });
  revalidatePath(PATH);
  return { ok: true, id: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// EMP-5E — classification. Which department is PROPOSED this mailbox.
// ---------------------------------------------------------------------------

/** Sentinel for "the caller sent something the vocabulary does not contain",
 *  kept distinct from the legitimate NULL. */
const INVALID = Symbol("invalid_eligibility");

function normalizeEligibility(v: string | null | undefined): string | null | typeof INVALID {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  // An empty string is how a `<select>` renders "Aucun". It is a real answer.
  if (t === "") return null;
  return isDepartmentEligibility(t) ? t : INVALID;
}

/**
 * Set or clear a mailbox's department eligibility.
 *
 * IT CHANGES EXACTLY ONE COLUMN. This is the whole safety property of the
 * action and the reason it is worth having its own function: eligibility
 * decides who is PROPOSED, and proposing is not granting. No membership is
 * created, none is revoked, no capability moves, no default sender changes, and
 * no historical row is touched — before or after. Someone who already holds
 * access keeps it when eligibility is cleared, because their access came from
 * an administrator's decision recorded on a membership row, not from this
 * column.
 *
 * Gated on `communication:mailbox:provision`: this is a property of the mailbox
 * identity, not of anyone's membership, and MAIL_ADMIN holds it. SYSTEM_ADMIN
 * holds neither mail permission and therefore cannot reach this.
 *
 * A PERSONAL mailbox is REFUSED rather than warned. Silently accepting it would
 * store a value that the classifier then has to ignore, and a stored fact the
 * engine overrules is worse than an error message.
 */
export async function setDepartmentEligibility(
  mailboxId: string,
  value: string | null,
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  const eligibility = normalizeEligibility(value);
  if (eligibility === INVALID) return { ok: false, error: "invalid_eligibility" };

  const admin = getAdminSupabaseClient();
  const { data: current } = await admin
    .from("ec_mailbox")
    .select("id, address, mailbox_type, department_eligibility")
    .eq("id", mailboxId).eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!current) return { ok: false, error: "mailbox_not_found" };

  const mb = current as unknown as {
    address: string; mailbox_type: string; department_eligibility: string | null;
  };
  if (eligibility && !canHoldDepartmentEligibility(mb.mailbox_type)) {
    return { ok: false, error: "personal_not_departmental" };
  }
  if ((mb.department_eligibility ?? null) === eligibility) {
    return { ok: true, id: mailboxId };
  }

  const { error } = await admin
    .from("ec_mailbox")
    .update({ department_eligibility: eligibility })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_CLASSIFIED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { department_eligibility: mb.department_eligibility ?? null },
    after: { department_eligibility: eligibility, address: mb.address },
  });
  revalidatePath(PATH);
  revalidatePath("/users");
  return { ok: true, id: mailboxId };
}

/**
 * Record what an operator did outside the platform.
 *
 * ACTIVE means a human confirmed the external mailbox exists and works.
 * SETUP_FAILED means a human reported it did not. The platform performs no
 * external provisioning and therefore cannot observe either — it records a
 * statement, and the audit trail names who made it.
 */
export async function recordSetupOutcome(
  mailboxId: string,
  outcome: "ACTIVE" | "SETUP_FAILED",
  note: string,
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const { data, error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: outcome,
      provisioning_note: note.slice(0, 500),
      provisioned_at: outcome === "ACTIVE" ? new Date().toISOString() : null,
      provisioned_by: user.id,
    })
    .eq("id", mailboxId)
    .eq("tenant_id", user.tenantId)
    .in("provisioning_status", ["PENDING_EXTERNAL_SETUP", "SETUP_FAILED"])
    .select("id, address")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_pending" };

  await writeAudit({
    action: outcome === "ACTIVE" ? AuditActions.EC_MAILBOX_SETUP_CONFIRMED : AuditActions.EC_MAILBOX_SETUP_FAILED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    after: { outcome, note: note.slice(0, 500), address: (data as { address: string }).address },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * Retry a failed setup.
 *
 * It returns the mailbox to PENDING_EXTERNAL_SETUP and increments the attempt
 * count. It calls nothing — there is no external system to call — so "retry"
 * here means "ask the operator again", and the count is how many times we have.
 */
export async function retryProvisioning(mailboxId: string): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const { data: current } = await admin
    .from("ec_mailbox")
    .select("id, provisioning_attempts")
    .eq("id", mailboxId).eq("tenant_id", user.tenantId)
    .eq("provisioning_status", "SETUP_FAILED")
    .maybeSingle();
  if (!current) return { ok: false, error: "not_failed" };

  const { error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: "PENDING_EXTERNAL_SETUP",
      provisioning_attempts: Number((current as { provisioning_attempts: number }).provisioning_attempts ?? 0) + 1,
      provisioning_note: null,
    })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "retry_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_SETUP_RETRIED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/** Enable or disable an existing mailbox. Routing follows immediately. */
export async function setMailboxEnabled(
  mailboxId: string,
  enabled: boolean,
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const { data, error } = await admin
    .from("ec_mailbox")
    .update({ provisioning_status: enabled ? "ACTIVE" : "DISABLED" })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId)
    .in("provisioning_status", enabled ? ["DISABLED"] : ["ACTIVE"])
    .select("id, address")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "invalid_state" };

  await writeAudit({
    action: enabled ? AuditActions.EC_MAILBOX_ACTIVATED : AuditActions.EC_MAILBOX_DEACTIVATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    after: { address: (data as { address: string }).address },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * Change the capabilities of an ACTIVE membership.
 *
 * Separate from `grantMembership` because the intent differs: this adjusts an
 * existing relationship rather than establishing one, and it refuses to touch a
 * revoked row — reviving access must go through a grant, which records a new
 * grantor.
 */
export async function setMembershipCapabilities(
  memberId: string,
  capabilities: Capabilities,
): Promise<MailAdminResult> {
  const g = await gate("communication:membership:manage");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const patch: {
    can_read?: boolean; can_send?: boolean;
    can_manage_members?: boolean; is_default_sender?: boolean;
  } = {};
  if (capabilities.canRead !== undefined) patch.can_read = capabilities.canRead;
  if (capabilities.canSend !== undefined) patch.can_send = capabilities.canSend;
  if (capabilities.canManageMembers !== undefined) patch.can_manage_members = capabilities.canManageMembers;
  if (capabilities.isDefaultSender !== undefined) patch.is_default_sender = capabilities.isDefaultSender;
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };

  const { data, error } = await admin
    .from("ec_mailbox_member")
    .update(patch)
    .eq("id", memberId)
    .eq("tenant_id", user.tenantId)
    .is("revoked_at", null)
    .select("id, user_id, mailbox_id")
    .maybeSingle();

  if (error) {
    // Two schema rules can reject this, and an administrator can act on both —
    // so neither is allowed to arrive as a generic failure.
    //   23505 — the partial unique index: someone is already the default
    //           sender, and only one person can be.
    //   23514 — the CHECK (not is_default_sender or can_send): default sender
    //           without send authority is not a state the mailbox can hold.
    if (error.code === "23505") return { ok: false, error: "default_sender_conflict" };
    if (error.code === "23514") return { ok: false, error: "default_sender_requires_send" };
    return { ok: false, error: "update_failed" };
  }
  if (!data) return { ok: false, error: "not_active" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_MEMBER_GRANTED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox_member", entityId: memberId,
    after: { ...patch, ...(data as Record<string, unknown>) },
  });
  revalidatePath(PATH);
  revalidatePath("/users");
  return { ok: true, id: memberId };
}
