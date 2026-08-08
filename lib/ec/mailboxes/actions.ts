"use server";

/**
 * EMP-1 — mailbox administration, WRITE SIDE. Exactly one mutation exists:
 * flipping `ec_mailbox.is_active`.
 *
 * WHY THE ADMIN CLIENT, AND WHY THAT IS NOT A BYPASS
 * --------------------------------------------------
 * EC-1 gave every `ec_*` table a SELECT policy and NO insert/update/delete
 * policy. Under RLS that makes the table read-only to every session, so this
 * write cannot go through the user-context client.
 *
 * The alternative was a migration adding an UPDATE policy. That would have
 * introduced a new write boundary into the correspondence schema — a governance
 * change — to support one boolean. EMP-1's brief says to stop rather than widen
 * RLS without approval, so this takes the narrower path already established in
 * this codebase (EC-3C): reach past RLS with the admin client ONLY behind an
 * explicit application gate.
 *
 * The gate here is deliberately stricter than the read policy: reading these
 * tables needs `communication:inbound:read`; changing a mailbox needs
 * `communication:manage`. Tenant ownership is re-checked in the WHERE clause, so
 * a forged id cannot reach another tenant's mailbox even with the gate passed.
 *
 * WHAT THIS FILE DELIBERATELY CANNOT DO: create a mailbox, delete one, or edit
 * an address. EC-1 made addresses globally unique because two tenants claiming
 * one address makes routing a guess; creation stays an operator act, and this
 * surface administers only what already exists. Deactivation is the reversible
 * control — retire, never delete.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export type MailboxActionResult = { ok: true } | { ok: false; error: string };

export async function setMailboxActive(
  mailboxId: string,
  active: boolean,
): Promise<MailboxActionResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) {
    return { ok: false, error: "forbidden" };
  }

  const admin = getAdminSupabaseClient();

  // Read-back under the tenant predicate first: this is what stops a mailbox id
  // from another tenant being flipped by a caller who holds the permission in
  // their own tenant.
  const { data: box } = await admin
    .from("ec_mailbox")
    .select("id, address, is_active")
    .eq("id", mailboxId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!box) return { ok: false, error: "not_found" };
  if ((box as { is_active: boolean }).is_active === active) return { ok: true };

  const { error } = await admin
    .from("ec_mailbox")
    .update({ is_active: active })
    .eq("id", mailboxId)
    .eq("tenant_id", user.tenantId);

  if (error) {
    reportError(error, { scope: "action", event: "ec.mailbox.set_active" });
    return { ok: false, error: "update_failed" };
  }

  // The address is an identifier, and identifying WHICH mailbox changed is the
  // whole value of the record. No message content is involved.
  await writeAudit({
    action: active ? AuditActions.EC_MAILBOX_ACTIVATED : AuditActions.EC_MAILBOX_DEACTIVATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "ec_mailbox",
    entityId: mailboxId,
    before: { is_active: !active },
    after: { is_active: active, address: (box as { address: string }).address },
  });

  revalidatePath("/mail/mailboxes");
  revalidatePath(`/mail/mailboxes/${mailboxId}`);
  return { ok: true };
}
