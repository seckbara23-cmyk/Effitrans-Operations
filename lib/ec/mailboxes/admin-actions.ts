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
import {
  activationGuard, canonicalState, canTransition, isLegacyActive,
  type LifecycleFacts, type MailboxState,
} from "./lifecycle";

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
 * RÉSERVER — step 1. Reserve an internal mailbox identity.
 *
 * It lands in RESERVED, not ACTIVE: the address exists in this platform and is
 * reserved against the global unique index, but nothing is claimed about the
 * world outside. Routing stays off (is_active is derived from the status) until
 * the mailbox has been configured, verified and explicitly activated.
 *
 * EMP-5F set the column default to RESERVED too, so even an insert that omits
 * the status cannot produce an operational mailbox.
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
      provisioning_status: "RESERVED",
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
    after: { address, mailbox_type: input.mailboxType, prior_state: null, next_state: "RESERVED",
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

// ---------------------------------------------------------------------------
// EMP-5F — the governed lifecycle: RÉSERVER → CONFIGURER → VÉRIFIER → ACTIVER.
//
// Every function below reads the mailbox first, decides with the PURE lifecycle
// module, and only then writes. None of them contains an activation rule of its
// own: `activationGuard` is the single authority, and a rule that lives in two
// places is a rule that will be enforced in one.
// ---------------------------------------------------------------------------

/** The columns a lifecycle decision needs, in one place so no reader drifts. */
const LIFECYCLE_SELECT =
  "id, tenant_id, address, mailbox_type, owner_user_id, provisioning_status, "
  + "provisioning_note, provisioning_attempts, ownership, external_provider, "
  + "external_mailbox_id, corporate_identity_confirmed_at, corporate_identity_confirmed_by, "
  + "outbound_verified_at, outbound_verified_by, outbound_verification_ref, "
  + "inbound_verified_at, inbound_verified_by, inbound_verification_ref, "
  + "activated_at, activated_by";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toFacts(r: any): LifecycleFacts {
  return {
    id: r.id, tenantId: r.tenant_id, address: r.address,
    mailboxType: r.mailbox_type, ownerUserId: r.owner_user_id ?? null,
    provisioningStatus: r.provisioning_status,
    provisioningNote: r.provisioning_note ?? null,
    ownership: r.ownership ?? "UNKNOWN",
    externalProvider: r.external_provider ?? null,
    externalMailboxId: r.external_mailbox_id ?? null,
    corporateIdentityConfirmedAt: r.corporate_identity_confirmed_at ?? null,
    corporateIdentityConfirmedBy: r.corporate_identity_confirmed_by ?? null,
    outboundVerifiedAt: r.outbound_verified_at ?? null,
    outboundVerifiedBy: r.outbound_verified_by ?? null,
    outboundVerificationRef: r.outbound_verification_ref ?? null,
    inboundVerifiedAt: r.inbound_verified_at ?? null,
    inboundVerifiedBy: r.inbound_verified_by ?? null,
    inboundVerificationRef: r.inbound_verification_ref ?? null,
    activatedAt: r.activated_at ?? null,
    activatedBy: r.activated_by ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Read one mailbox's lifecycle facts, tenant-scoped. */
async function loadFacts(
  mailboxId: string,
  tenantId: string,
): Promise<LifecycleFacts | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_mailbox").select(LIFECYCLE_SELECT)
    .eq("id", mailboxId).eq("tenant_id", tenantId).maybeSingle();
  return data ? toFacts(data) : null;
}

/**
 * CONFIGURER — step 2. Record the provider relationship.
 *
 * This records WHO IS AUTHORITATIVE and WHERE the mailbox lives. It proves
 * nothing about the mailbox working, and deliberately cannot: the platform
 * integrates with no provider, so everything here is a person's statement and
 * is stored as one.
 *
 * It never confirms the corporate identity — that is a VERIFICATION act, and
 * keeping it separate is what leaves room for a different person to check it.
 */
export async function recordMailboxConfiguration(
  mailboxId: string,
  input: {
    ownership: "PLATFORM_MANAGED" | "CORPORATE_EXISTING";
    externalProvider?: string | null;
    externalMailboxId?: string | null;
    integrationAddress?: string | null;
    note?: string;
  },
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  if (input.ownership !== "PLATFORM_MANAGED" && input.ownership !== "CORPORATE_EXISTING") {
    return { ok: false, error: "invalid_ownership" };
  }
  if (!input.externalProvider?.trim() && !input.externalMailboxId?.trim()) {
    // Without either, "configured" would mean nothing that could later be checked.
    return { ok: false, error: "external_reference_required" };
  }
  const integration = input.integrationAddress?.trim().toLowerCase() || null;
  if (integration && (!integration.includes("@") || integration.length > 320)) {
    return { ok: false, error: "invalid_integration_address" };
  }

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };

  const from = canonicalState(facts.provisioningStatus);
  if (!canTransition(from, "CONFIGURED")) return { ok: false, error: "invalid_state" };

  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: "CONFIGURED",
      ownership: input.ownership,
      external_provider: input.externalProvider?.trim() || null,
      external_mailbox_id: input.externalMailboxId?.trim() || null,
      integration_address: integration,
      provisioning_note: input.note?.slice(0, 500) ?? null,
      provisioned_at: null,
      provisioned_by: user.id,
    })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_CONFIGURED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from, ownership: facts.ownership },
    after: {
      next_state: "CONFIGURED", address: facts.address, ownership: input.ownership,
      external_provider: input.externalProvider?.trim() || null,
      // The identifier is a reconciliation key, never a credential.
      external_mailbox_id: input.externalMailboxId?.trim() || null,
      reason: input.note?.slice(0, 500) ?? null,
    },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/** VÉRIFIER — step 3a. Put the mailbox forward for checking. */
export async function submitMailboxForVerification(mailboxId: string): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };
  const from = canonicalState(facts.provisioningStatus);
  if (!canTransition(from, "PENDING_VERIFICATION")) return { ok: false, error: "invalid_state" };

  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: "PENDING_VERIFICATION",
      verification_submitted_at: new Date().toISOString(),
      verification_submitted_by: user.id,
    })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_VERIFICATION_SUBMITTED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from },
    after: { next_state: "PENDING_VERIFICATION", address: facts.address },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * VÉRIFIER — step 3b. Record a verification result.
 *
 * THREE INDEPENDENT CAPABILITIES (EMP-5F Option B). Identity is what ACTIVE
 * depends on; outbound and inbound are separate readiness facts, because
 * requiring inbound proof to permit outbound use would block a legitimate
 * outbound-only arrangement — and coexistence with Effitrans's corporate mail
 * may well be exactly that.
 *
 * `evidenceRef` points at something already stored elsewhere (a provider
 * message id, an `ec_webhook_event` id) so the claim is CHECKABLE rather than
 * self-asserted. It is required for the capability checks and is never a secret.
 */
export async function recordVerificationOutcome(
  mailboxId: string,
  input: {
    capability: "IDENTITY" | "OUTBOUND" | "INBOUND";
    passed: boolean;
    evidenceRef?: string | null;
    note?: string;
  },
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };
  const from = canonicalState(facts.provisioningStatus);

  const ref = input.evidenceRef?.trim() || null;
  if (input.passed && input.capability !== "IDENTITY" && !ref) {
    // A capability that "works" with nothing to point at is an assertion
    // wearing the word evidence.
    return { ok: false, error: "evidence_reference_required" };
  }

  const now = new Date().toISOString();
  // Typed rather than `Record<string, unknown>`: the point of this function is
  // that it writes evidence columns and nothing else, and a loose type would
  // let a stray key through the one place that must not have one.
  const patch: {
    provisioning_status?: string;
    provisioning_note?: string | null;
    corporate_identity_confirmed_at?: string | null;
    corporate_identity_confirmed_by?: string | null;
    outbound_verified_at?: string | null;
    outbound_verified_by?: string | null;
    outbound_verification_ref?: string | null;
    inbound_verified_at?: string | null;
    inbound_verified_by?: string | null;
    inbound_verification_ref?: string | null;
  } = {};
  let nextState: MailboxState = from;

  if (!input.passed) {
    if (!canTransition(from, "FAILED")) return { ok: false, error: "invalid_state" };
    nextState = "FAILED";
    patch.provisioning_status = "FAILED";
    patch.provisioning_note = (input.note ?? "").slice(0, 500);
  } else if (input.capability === "IDENTITY") {
    if (!canTransition(from, "VERIFIED")) return { ok: false, error: "invalid_state" };
    nextState = "VERIFIED";
    patch.provisioning_status = "VERIFIED";
    patch.corporate_identity_confirmed_at = now;
    patch.corporate_identity_confirmed_by = user.id;
    patch.provisioning_note = input.note?.slice(0, 500) ?? null;
  } else if (input.capability === "OUTBOUND") {
    patch.outbound_verified_at = now;
    patch.outbound_verified_by = user.id;
    patch.outbound_verification_ref = ref;
  } else {
    patch.inbound_verified_at = now;
    patch.inbound_verified_by = user.id;
    patch.inbound_verification_ref = ref;
  }

  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("ec_mailbox").update(patch)
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: input.passed
      ? AuditActions.EC_MAILBOX_VERIFICATION_PASSED
      : AuditActions.EC_MAILBOX_VERIFICATION_FAILED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from },
    after: {
      next_state: nextState, address: facts.address, capability: input.capability,
      evidence_ref: ref, evidence_kind: "manual",
      reason: input.note?.slice(0, 500) ?? null,
    },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * ACTIVER — step 4. Put a VERIFIED mailbox into operational use.
 *
 * THE ONLY WAY TO REACH ACTIVE. Every rule is `activationGuard`'s, evaluated
 * against facts this function re-read from the database rather than anything a
 * caller supplied, and the blockers are returned so the administrator learns
 * what is missing instead of being told "no".
 *
 * The actor is `requireUser()`'s. There is no SYSTEM lane (RATIFY-OPSSEC2-2A),
 * and the guard refuses a null actor anyway.
 */
export type ActivationResult =
  | { ok: true; id: string }
  | { ok: false; error: string; blockers?: { code: string; messageFr: string }[] };

export async function activateMailbox(mailboxId: string): Promise<ActivationResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canProvision = hasPermission(permissions, "communication:mailbox:provision");

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };

  const now = new Date().toISOString();
  const decision = activationGuard({
    actor: { id: user.id, tenantId: user.tenantId, canProvision },
    mailbox: facts,
    now,
  });
  if (!decision.allowed) {
    return { ok: false, error: "activation_refused", blockers: decision.blockers };
  }

  const from = canonicalState(facts.provisioningStatus);
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: "ACTIVE",
      activated_at: now,
      activated_by: user.id,
      provisioned_at: now,
    })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId)
    // Compare-and-set on the state the guard actually judged: another
    // administrator may have moved this mailbox while the page was open.
    .eq("provisioning_status", facts.provisioningStatus);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_ACTIVATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from },
    after: {
      next_state: "ACTIVE", address: facts.address,
      verified_by: facts.corporateIdentityConfirmedBy,
      evidence_ref: facts.outboundVerificationRef ?? facts.inboundVerificationRef ?? null,
      reason: "verified evidence accepted",
    },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * Retry after a failure.
 *
 * It returns the mailbox to CONFIGURATION_REQUIRED and increments the attempt
 * count. It calls nothing — there is no external system to call — so "retry"
 * means "ask the operator again", and the count is how many times we have.
 *
 * IT DOES NOT ERASE THE FAILURE EVIDENCE. The note that recorded why it failed
 * is carried into the audit entry before the column is cleared, so the history
 * survives a retry that resets the working state.
 */
export async function retryProvisioning(mailboxId: string): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };
  const from = canonicalState(facts.provisioningStatus);
  if (from !== "FAILED") return { ok: false, error: "not_failed" };

  const { data: current } = await admin
    .from("ec_mailbox").select("provisioning_attempts")
    .eq("id", mailboxId).eq("tenant_id", user.tenantId).maybeSingle();

  const { error } = await admin
    .from("ec_mailbox")
    .update({
      provisioning_status: "CONFIGURATION_REQUIRED",
      provisioning_attempts: Number((current as { provisioning_attempts: number } | null)?.provisioning_attempts ?? 0) + 1,
      provisioning_note: null,
    })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "retry_failed" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_SETUP_RETRIED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from, reason: facts.provisioningNote },
    after: { next_state: "CONFIGURATION_REQUIRED", address: facts.address },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * Take a mailbox out of service.
 *
 * DEACTIVATION ONLY. Re-enabling used to live here and flipped straight to
 * ACTIVE from DISABLED with no evidence examined at all — a second, ungoverned
 * door into the operational state. Activation now has exactly one door,
 * `activateMailbox`, and it is guarded.
 *
 * The history is preserved: nothing is deleted, `activated_by` and the
 * verification evidence stay on the row, and the audit records both states.
 */
export async function setMailboxEnabled(
  mailboxId: string,
  enabled: boolean,
): Promise<MailAdminResult> {
  if (enabled) {
    // Not an oversight, and not silently redirected either: activation must go
    // through the guard, and saying so is more useful than pretending.
    return { ok: false, error: "activation_requires_verification" };
  }

  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;
  const admin = getAdminSupabaseClient();

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };
  const from = canonicalState(facts.provisioningStatus);
  if (from !== "ACTIVE") return { ok: false, error: "invalid_state" };

  const { error } = await admin
    .from("ec_mailbox")
    .update({ provisioning_status: "DISABLED" })
    .eq("id", mailboxId).eq("tenant_id", user.tenantId)
    .eq("provisioning_status", facts.provisioningStatus);
  if (error) return { ok: false, error: "invalid_state" };

  await writeAudit({
    action: AuditActions.EC_MAILBOX_DEACTIVATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: from, activated_by: facts.activatedBy },
    after: { next_state: "DISABLED", address: facts.address },
  });
  revalidatePath(PATH);
  return { ok: true, id: mailboxId };
}

/**
 * Record a decision about a LEGACY-UNVERIFIED ACTIVE mailbox.
 *
 * A row that reached ACTIVE before this lifecycle existed cannot be verified
 * retroactively, and must not be silently deactivated: the company may be using
 * it. So the platform records the DECISION and the reason, changes nothing
 * about the mailbox, and leaves the remediation itself to the ordinary
 * lifecycle actions an administrator then takes deliberately.
 *
 * This is the audit entry that makes "we looked at it and chose to wait" a
 * recorded act rather than an absence.
 */
export async function recordLegacyActiveDecision(
  mailboxId: string,
  decision: "CONFIRM_PERSONAL" | "CONFIRM_SHARED" | "RECLASSIFY_FUNCTIONAL"
          | "DISABLE_PENDING_VERIFICATION" | "KEEP_RESTRICTED",
  reason: string,
): Promise<MailAdminResult> {
  const g = await gate("communication:mailbox:provision");
  if (!g.ok || !g.user) return { ok: false, error: "forbidden" };
  const { user } = g;

  if (!reason.trim()) return { ok: false, error: "reason_required" };

  const facts = await loadFacts(mailboxId, user.tenantId);
  if (!facts) return { ok: false, error: "mailbox_not_found" };
  if (!isLegacyActive(facts)) return { ok: false, error: "not_legacy_active" };

  // DELIBERATELY NO MAILBOX WRITE. Recording an intention is not carrying it
  // out, and a decision that quietly retyped or disabled a live corporate
  // address would be exactly the disruption this programme forbids.
  await writeAudit({
    action: AuditActions.EC_MAILBOX_LEGACY_DECISION,
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_mailbox", entityId: mailboxId,
    before: { prior_state: canonicalState(facts.provisioningStatus), activated_by: null },
    after: {
      next_state: canonicalState(facts.provisioningStatus),
      address: facts.address, decision, reason: reason.slice(0, 500),
      note: "decision recorded only — no mailbox field was changed",
    },
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
