import "server-only";

/**
 * Digital business card resolution (DBC-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * PUBLIC resolution by token (no session): the token is the capability. Returns null —
 * which the route turns into a UNIFORM 404 — for every non-published condition, so nothing
 * reveals whether a user exists:
 *   token unknown/rotated · card not opted in · employee inactive · tenant suspended/
 *   archived/trial-expired · brand incomplete (do not publish incomplete branding).
 * The resolved model is public-safe (no tenant/user/db id, no token, no storage path).
 *
 * ADMIN resolution by userId is gated by admin:users:manage and used only to manage/preview.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { tenantBlockReason, isLifecycleStatus, type LifecycleStatus } from "@/lib/platform/company-metadata";
import { readBrandCore } from "./service";
import { buildCardModel, cardReadiness, type CardModel, type CardReadiness } from "@/lib/brand/card/model";

type Embedded = {
  user_id: string; tenant_id: string; job_title: string | null; phone_office: string | null;
  phone_mobile: string | null; whatsapp: string | null; photo_asset_id: string | null; public_card_enabled: boolean;
  app_user: { name: string | null; email: string; status: string } | { name: string | null; email: string; status: string }[] | null;
  organization: { name: string; trade_name: string | null; lifecycle_status: string; trial_ends_at: string | null } | Record<string, unknown>[] | null;
};

function one<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Resolve a public card by token, or null (→ 404). Uses the service role; token-scoped.
 *  Request-memoized so metadata + page + a download in the same request share ONE read. */
export const resolveCardByToken = cache(async (token: string): Promise<CardModel | null> => {
  if (!token || token.length < 16) return null;
  const admin = getAdminSupabaseClient();

  const { data } = await admin
    .from("workforce_profile")
    .select(
      "user_id, tenant_id, job_title, phone_office, phone_mobile, whatsapp, photo_asset_id, public_card_enabled, " +
        "app_user:user_id(name, email, status), organization:tenant_id(name, trade_name, lifecycle_status, trial_ends_at)",
    )
    .eq("public_card_token", token)
    .maybeSingle();

  const row = data as Embedded | null;
  if (!row || !row.public_card_enabled) return null;

  const user = one(row.app_user) as { name: string | null; email: string; status: string } | null;
  if (!user || user.status !== "active") return null;

  const org = one(row.organization) as { name: string; trade_name: string | null; lifecycle_status: string; trial_ends_at: string | null } | null;
  if (!org || !isLifecycleStatus(org.lifecycle_status)) return null;
  if (tenantBlockReason(org.lifecycle_status as LifecycleStatus, org.trial_ends_at, Date.now()) !== null) return null;

  const core = await readBrandCore(row.tenant_id);
  if (!cardReadiness(core.profile, core.assets).ready) return null; // do not publish incomplete branding

  return buildCardModel({
    companyName: core.displayName,
    profileUrl: `${siteUrl()}/card/${token}`,
    profile: core.profile,
    assets: core.assets,
    memberships: core.memberships,
    employee: {
      name: user.name ?? user.email, title: row.job_title, department: null, email: user.email,
      phoneOffice: row.phone_office, phoneMobile: row.phone_mobile, whatsapp: row.whatsapp, photoAssetId: row.photo_asset_id,
    },
  });
});

export type CardAdminView = {
  name: string;
  enabled: boolean;
  hasToken: boolean;
  profileUrl: string | null;
  readiness: CardReadiness;
};

/** Admin-side status for the card studio. Gated admin:users:manage; tenant-scoped. */
export async function getCardAdminView(userId: string): Promise<CardAdminView | null> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();

  const { data: u } = await supabase.from("app_user").select("id, tenant_id, name, email").eq("id", userId).maybeSingle();
  if (!u || u.tenant_id !== admin.tenantId) return null;

  const { data: w } = await supabase.from("workforce_profile").select("public_card_enabled, public_card_token").eq("user_id", userId).maybeSingle();
  const core = await readBrandCore(admin.tenantId);
  const token = w?.public_card_token ?? null;

  return {
    name: u.name ?? u.email,
    enabled: Boolean(w?.public_card_enabled),
    hasToken: Boolean(token),
    profileUrl: token ? `${siteUrl()}/card/${token}` : null,
    readiness: cardReadiness(core.profile, core.assets),
  };
}
