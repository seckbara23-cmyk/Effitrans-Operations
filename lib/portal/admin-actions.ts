"use server";

/**
 * Portal user administration actions (Phase 1.12A). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Staff (portal:manage) invite/manage client portal users from the client page.
 * Service-role: creates the auth user via the Supabase Auth admin API + a
 * set-password/invite link (surfaced to the admin while email is not wired) and
 * inserts the client_user row. Guards against dual identity (an email that is
 * already a staff app_user can never become a portal user).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { sendEmail } from "@/lib/comms/provider";
import { generateTempPassword } from "./temp-password";
import { buildPortalCredentialsEmail, passwordEmailAllowed } from "./credentials-email";
import { canResetPortalPassword, isPortalRole, isPortalStatus } from "./access";
import type { ActionResult } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * OPTIONAL, best-effort credentials email. NEVER blocks onboarding (the account
 * works even if email fails) and NEVER includes the temporary password unless
 * BOTH PORTAL_ALLOW_PASSWORD_EMAIL=true AND the admin opted in.
 */
async function maybeSendCredentials(o: {
  send: boolean | undefined;
  email: string;
  clientName: string | null;
  tempPassword: string;
}): Promise<void> {
  if (!o.send) return;
  try {
    const includePassword = passwordEmailAllowed(process.env.PORTAL_ALLOW_PASSWORD_EMAIL, true);
    const content = buildPortalCredentialsEmail({
      loginUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/portal/login`,
      email: o.email,
      clientName: o.clientName,
      includePassword,
      tempPassword: includePassword ? o.tempPassword : undefined,
    });
    await sendEmail({ to: o.email, toName: o.clientName, subject: content.subject, html: content.html, text: content.text });
  } catch {
    /* best-effort — the temporary password was already shown to the admin */
  }
}

export async function invitePortalUser(
  clientId: string,
  input: { email: string; name?: string | null; role?: string },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const email = input.email.trim().toLowerCase();
  const role = input.role && isPortalRole(input.role) ? input.role : "CLIENT_USER";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };

  const supabase = getAdminSupabaseClient();

  const { data: client } = await supabase
    .from("client")
    .select("id, tenant_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client || client.tenant_id !== user.tenantId) return { ok: false, error: "client_not_found" };

  // Dual-identity guard: a staff email must never become a portal user.
  const { data: staff } = await supabase.from("app_user").select("id").eq("email", email).maybeSingle();
  if (staff) return { ok: false, error: "email_is_staff" };

  const { data: existing } = await supabase
    .from("client_user")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .eq("email", email)
    .maybeSingle();
  if (existing) return { ok: false, error: "already_exists" };

  // Create the auth user + invite (set-password) link.
  const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
  });
  if (linkErr || !link?.user) return { ok: false, error: "invite_failed" };

  const { error: insErr } = await supabase.from("client_user").insert({
    id: link.user.id,
    tenant_id: user.tenantId,
    client_id: clientId,
    email,
    name: input.name?.trim() || null,
    role,
    status: "INVITED",
    invited_by: user.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  await writeAudit({
    action: AuditActions.PORTAL_USER_INVITED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "client_user",
    entityId: link.user.id,
    after: { email, client_id: clientId, role },
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, id: link.user.id, inviteLink: link.properties?.action_link };
}

/**
 * Phase 3.2B — create a portal account with an admin-shared TEMPORARY PASSWORD.
 * The account is created directly in Supabase Auth WITH the password and a
 * confirmed email, so the client can sign in immediately — NO invitation email
 * is required. The account is ACTIVE with must_change_password = true, so the
 * first login is forced through /portal/auth/change-password. The temporary
 * password is returned ONCE for one-time display and is NEVER stored, logged,
 * or placed in the audit payload.
 */
export async function createPortalAccess(
  clientId: string,
  input: { email: string; name?: string | null; role?: string; sendEmail?: boolean },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const email = input.email.trim().toLowerCase();
  const role = input.role && isPortalRole(input.role) ? input.role : "CLIENT_USER";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };

  const supabase = getAdminSupabaseClient();

  const { data: client } = await supabase
    .from("client")
    .select("id, tenant_id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client || client.tenant_id !== user.tenantId) return { ok: false, error: "client_not_found" };

  // Dual-identity guard: a staff email must never become a portal user.
  const { data: staff } = await supabase.from("app_user").select("id").eq("email", email).maybeSingle();
  if (staff) return { ok: false, error: "email_is_staff" };

  const { data: existing } = await supabase
    .from("client_user")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .eq("email", email)
    .maybeSingle();
  if (existing) return { ok: false, error: "already_exists" };

  const tempPassword = generateTempPassword();

  // Create the auth user WITH the password + confirmed email — login works now.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createErr || !created?.user) return { ok: false, error: "create_failed" };

  const { error: insErr } = await supabase.from("client_user").insert({
    id: created.user.id,
    tenant_id: user.tenantId,
    client_id: clientId,
    email,
    name: input.name?.trim() || null,
    role,
    status: "ACTIVE",
    must_change_password: true,
    invited_by: user.id,
  });
  if (insErr) {
    // Roll back the orphan auth user so a retry can re-create cleanly.
    try {
      await supabase.auth.admin.deleteUser(created.user.id);
    } catch {
      /* best-effort cleanup */
    }
    return { ok: false, error: insErr.message };
  }

  await writeAudit({
    action: AuditActions.PORTAL_USER_CREATED_WITH_TEMP_PASSWORD,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "client_user",
    entityId: created.user.id,
    after: { email, client_id: clientId, role }, // NEVER the password
  });

  await maybeSendCredentials({ send: input.sendEmail, email, clientName: client.name, tempPassword });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, id: created.user.id, tempPassword, email };
}

/**
 * Phase 3.2B — reset an existing portal user's password to a new TEMPORARY one
 * and re-arm the forced change. Same-tenant only; a DISABLED user is rejected
 * (reactivate first). Returns the new password ONCE; never stored/logged/audited.
 */
export async function resetPortalTempPassword(
  id: string,
  opts?: { sendEmail?: boolean },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: cu } = await supabase
    .from("client_user")
    .select("id, client_id, tenant_id, email, name, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId) // cross-tenant → not found
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_found" };
  if (!canResetPortalPassword(cu.status)) return { ok: false, error: "disabled" };

  const tempPassword = generateTempPassword();
  const { error: upErr } = await supabase.auth.admin.updateUserById(id, { password: tempPassword });
  if (upErr) return { ok: false, error: "reset_failed" };

  const { error } = await supabase
    .from("client_user")
    .update({ must_change_password: true })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.PORTAL_USER_TEMP_PASSWORD_RESET,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "client_user",
    entityId: id,
    after: { client_id: cu.client_id }, // NEVER the password
  });

  await maybeSendCredentials({ send: opts?.sendEmail, email: cu.email, clientName: cu.name, tempPassword });

  revalidatePath(`/clients/${cu.client_id}`);
  return { ok: true, id, tempPassword, email: cu.email };
}

export async function setPortalUserStatus(id: string, status: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isPortalStatus(status) || status === "INVITED") return { ok: false, error: "invalid_status" };

  const supabase = getAdminSupabaseClient();
  const { data: cu } = await supabase
    .from("client_user")
    .select("id, client_id, tenant_id, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("client_user")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  if (status === "ACTIVE") {
    await writeAudit({
      action: AuditActions.PORTAL_USER_ACTIVATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "client_user",
      entityId: id,
    });
  }
  revalidatePath(`/clients/${cu.client_id}`);
  return { ok: true, id };
}

export async function setPortalUserRole(id: string, role: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isPortalRole(role)) return { ok: false, error: "invalid_role" };

  const supabase = getAdminSupabaseClient();
  const { data: cu } = await supabase
    .from("client_user")
    .select("id, client_id")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("client_user")
    .update({ role })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/clients/${cu.client_id}`);
  return { ok: true, id };
}

/** Re-issue a set-password (recovery) link for an existing portal user. */
export async function resendPortalInvite(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("portal:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: cu } = await supabase
    .from("client_user")
    .select("id, email")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_found" };

  const { data: link, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: cu.email,
  });
  if (error || !link) return { ok: false, error: "invite_failed" };
  return { ok: true, id, inviteLink: link.properties?.action_link };
}
