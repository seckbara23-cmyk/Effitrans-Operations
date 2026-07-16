"use server";

/**
 * Digital business card management (DBC-3). SERVER ACTIONS — administrators only.
 * ---------------------------------------------------------------------------
 * Enable / disable / rotate the public card opt-in, and record admin preview/download
 * events. Gated by admin:users:manage (reused), tenant-scoped. Enabling refuses when the
 * Brand Center is incomplete (do not publish incomplete branding). The token is CSPRNG,
 * never derived from ids; rotation issues a NEW token and the old URL immediately 404s.
 * Audits carry SAFE metadata only — never the token value, the URL, or contact data.
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { cardReadiness } from "@/lib/brand/card/model";

export type CardResult = { ok: true } | { ok: false; error: "forbidden" | "not_found" | "brand_incomplete"; missing?: string[] };

function newToken(): string {
  return randomBytes(24).toString("base64url"); // ≥128-bit, unguessable, not derived from ids
}

async function verifyTarget(supabase: ReturnType<typeof getAdminSupabaseClient>, tenantId: string, userId: string): Promise<boolean> {
  const { data } = await supabase.from("app_user").select("id, tenant_id").eq("id", userId).maybeSingle();
  return Boolean(data && data.tenant_id === tenantId);
}

/** Enable or disable the public card. Enabling requires a card-ready Brand Center. */
export async function setPublicCard(userId: string, enabled: boolean): Promise<CardResult> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const supabase = getAdminSupabaseClient();
  if (!(await verifyTarget(supabase, admin.tenantId, userId))) return { ok: false, error: "not_found" };

  if (enabled) {
    const core = await readBrandCore(admin.tenantId);
    const readiness = cardReadiness(core.profile, core.assets);
    if (!readiness.ready) return { ok: false, error: "brand_incomplete", missing: readiness.missing };
  }

  // On enable, mint a token if none exists yet. On disable, keep the token (re-enable reuses
  // it) — the opt-in flag alone gates publication.
  const { data: existing } = await supabase.from("workforce_profile").select("public_card_token").eq("user_id", userId).maybeSingle();
  const row: Record<string, unknown> = { user_id: userId, tenant_id: admin.tenantId, public_card_enabled: enabled, updated_by: admin.id };
  if (enabled && !existing?.public_card_token) { row.public_card_token = newToken(); row.token_rotated_at = new Date().toISOString(); }

  const { error } = await supabase.from("workforce_profile").upsert(row as never, { onConflict: "user_id" });
  if (error) return { ok: false, error: "not_found" };

  await writeAudit({
    action: enabled ? AuditActions.BRAND_CARD_ENABLED : AuditActions.BRAND_CARD_DISABLED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId,
  });
  revalidatePath(`/brand-center/card/${userId}`);
  return { ok: true };
}

/** Rotate the token: new token now, old URL 404s immediately. Never audits the token value. */
export async function rotateCardToken(userId: string): Promise<CardResult> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const supabase = getAdminSupabaseClient();
  if (!(await verifyTarget(supabase, admin.tenantId, userId))) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("workforce_profile")
    .upsert({ user_id: userId, tenant_id: admin.tenantId, public_card_token: newToken(), token_rotated_at: new Date().toISOString(), updated_by: admin.id } as never, { onConflict: "user_id" });
  if (error) return { ok: false, error: "not_found" };

  await writeAudit({ action: AuditActions.BRAND_CARD_TOKEN_ROTATED, actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId });
  revalidatePath(`/brand-center/card/${userId}`);
  return { ok: true };
}

/** Record an admin preview or download. Audit only — no content stored. */
export async function recordCardEvent(userId: string, event: "previewed" | "vcard_downloaded" | "qr_downloaded"): Promise<{ ok: boolean }> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false }; }
  const supabase = getAdminSupabaseClient();
  if (!(await verifyTarget(supabase, admin.tenantId, userId))) return { ok: false };
  const action =
    event === "previewed" ? AuditActions.BRAND_CARD_PREVIEWED
    : event === "vcard_downloaded" ? AuditActions.BRAND_CARD_VCARD_DOWNLOADED
    : AuditActions.BRAND_CARD_QR_DOWNLOADED;
  await writeAudit({ action, actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId });
  return { ok: true };
}
