import "server-only";

/**
 * Brand Center reads (DBC-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Tenant-scoped admin reads via the service-role client, gated by an existing permission
 * and filtered by the caller's OWN tenant (admin.tenantId) — the exact doctrine of
 * lib/users/service.ts, so RLS on the brand tables is left unchanged. Bounded (a fixed
 * number of queries, no N+1). Never returns a public-card token or a raw file.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { primaryRoleLabel } from "@/lib/navigation/roles";
import {
  deriveBrandCompleteness, resolveComplianceCopy, type AssetKind, type BrandCompleteness, type ComplianceCopy,
} from "@/lib/brand/model";

const PUBLIC_BUCKET = "brand-assets";

export type BrandProfile = {
  colorGreen: string | null; colorGold: string | null; colorAnthracite: string | null;
  fontHeading: string | null; fontBody: string | null; fontEmailFallback: string | null;
  slogan: string | null; valueProposition: string | null; address: string | null; legalIdentifiers: string | null;
  websiteUrl: string | null; linkedinUrl: string | null; whistleblowerUrl: string | null;
  compliance: ComplianceCopy;
};

export type BrandAssetView = {
  id: string; kind: AssetKind; title: string | null; publicUrl: string; version: number;
  mime: string; bytes: number; width: number | null; height: number | null; altText: string;
  status: string; createdAt: string;
};

export type MembershipView = {
  id: string; organizationName: string; membershipId: string | null; officialUrl: string | null;
  status: string; validFrom: string | null; expiresAt: string | null; displayOrder: number;
  logoAssetId: string | null; assetUseNotes: string | null;
};

export type BrandCenterOverview = {
  profile: BrandProfile;
  legalName: string | null;
  assets: BrandAssetView[];
  memberships: MembershipView[];
  completeness: BrandCompleteness;
};

function pub(supabase: ReturnType<typeof getAdminSupabaseClient>, path: string): string {
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function getBrandCenterOverview(): Promise<BrandCenterOverview> {
  const admin = await assertPermission("admin:config:manage");
  const supabase = getAdminSupabaseClient();

  const [profileRes, assetsRes, membersRes, orgRes, wfRes] = await Promise.all([
    supabase.from("tenant_brand_profile").select("*").eq("tenant_id", admin.tenantId).maybeSingle(),
    supabase.from("brand_asset").select("id, kind, title, storage_path, version, mime, bytes, width, height, alt_text, status, created_at").eq("tenant_id", admin.tenantId).order("created_at", { ascending: false }),
    supabase.from("tenant_membership_registry").select("*").eq("tenant_id", admin.tenantId).order("display_order"),
    supabase.from("organization").select("legal_name, trade_name, name").eq("id", admin.tenantId).maybeSingle(),
    supabase.from("workforce_profile").select("job_title").eq("tenant_id", admin.tenantId),
  ]);

  const p = (profileRes.data ?? {}) as Record<string, string | null>;
  const profile: BrandProfile = {
    colorGreen: p.color_green ?? null, colorGold: p.color_gold ?? null, colorAnthracite: p.color_anthracite ?? null,
    fontHeading: p.font_heading ?? null, fontBody: p.font_body ?? null, fontEmailFallback: p.font_email_fallback ?? null,
    slogan: p.slogan ?? null, valueProposition: p.value_proposition ?? null, address: p.address ?? null, legalIdentifiers: p.legal_identifiers ?? null,
    websiteUrl: p.website_url ?? null, linkedinUrl: p.linkedin_url ?? null, whistleblowerUrl: p.whistleblower_url ?? null,
    compliance: resolveComplianceCopy({
      compliance_title: p.compliance_title, compliance_subtitle: p.compliance_subtitle,
      compliance_description: p.compliance_description, compliance_button_label: p.compliance_button_label,
      sustainability_statement: p.sustainability_statement, environmental_print_statement: p.environmental_print_statement,
      footer_line: p.footer_line,
    }),
  };

  const assets: BrandAssetView[] = (assetsRes.data ?? []).map((a) => ({
    id: a.id, kind: a.kind as AssetKind, title: a.title, publicUrl: pub(supabase, a.storage_path), version: a.version,
    mime: a.mime, bytes: a.bytes, width: a.width, height: a.height, altText: a.alt_text, status: a.status, createdAt: a.created_at,
  }));

  const memberships: MembershipView[] = (membersRes.data ?? []).map((m) => ({
    id: m.id, organizationName: m.organization_name, membershipId: m.membership_id, officialUrl: m.official_url,
    status: m.status, validFrom: m.valid_from, expiresAt: m.expires_at, displayOrder: m.display_order,
    logoAssetId: m.logo_asset_id, assetUseNotes: m.asset_use_notes,
  }));

  const org = orgRes.data as { legal_name: string | null; trade_name: string | null; name: string } | null;
  const publishedKinds = assets.filter((a) => a.status === "PUBLISHED").map((a) => a.kind);
  const workforceWithTitleCount = (wfRes.data ?? []).filter((w) => w.job_title && String(w.job_title).trim() !== "").length;

  const completeness = deriveBrandCompleteness({
    colors: { green: profile.colorGreen, gold: profile.colorGold, anthracite: profile.colorAnthracite },
    fonts: { heading: profile.fontHeading, body: profile.fontBody, fallback: profile.fontEmailFallback },
    slogan: profile.slogan, valueProposition: profile.valueProposition, website: profile.websiteUrl, address: profile.address,
    whistleblowerUrl: profile.whistleblowerUrl,
    publishedKinds,
    activeMembershipCount: memberships.filter((m) => m.status === "active").length,
    workforceWithTitleCount,
  });

  return { profile, legalName: org?.legal_name ?? null, assets, memberships, completeness };
}

export type WorkforceView = {
  userId: string; name: string; email: string; roleSummary: string | null;
  jobTitle: string | null; hasPhone: boolean; hasPhoto: boolean;
  signatureVariant: string; publicCardEnabled: boolean;
};

/** People list: app_user (authoritative) joined to workforce_profile. Gated admin:users:manage. */
export async function listWorkforceProfiles(): Promise<WorkforceView[]> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();

  const [usersRes, rolesRes, roleDefsRes, wfRes] = await Promise.all([
    supabase.from("app_user").select("id, name, email, status").eq("tenant_id", admin.tenantId).eq("status", "active").order("name"),
    supabase.from("user_role").select("user_id, role_id").eq("tenant_id", admin.tenantId),
    supabase.from("role").select("id, code").eq("tenant_id", admin.tenantId),
    supabase.from("workforce_profile").select("user_id, job_title, phone_office, phone_mobile, whatsapp, photo_asset_id, signature_variant, public_card_enabled").eq("tenant_id", admin.tenantId),
  ]);

  const roleCode = new Map((roleDefsRes.data ?? []).map((r) => [r.id, r.code]));
  const rolesByUser = new Map<string, string[]>();
  for (const ur of rolesRes.data ?? []) {
    const c = roleCode.get(ur.role_id);
    if (!c) continue;
    const list = rolesByUser.get(ur.user_id) ?? [];
    list.push(c);
    rolesByUser.set(ur.user_id, list);
  }
  const wfByUser = new Map((wfRes.data ?? []).map((w) => [w.user_id, w]));

  return (usersRes.data ?? []).map((u) => {
    const w = wfByUser.get(u.id);
    return {
      userId: u.id, name: u.name ?? u.email, email: u.email,
      roleSummary: primaryRoleLabel(rolesByUser.get(u.id) ?? []),
      jobTitle: w?.job_title ?? null,
      hasPhone: Boolean(w?.phone_office || w?.phone_mobile || w?.whatsapp),
      hasPhoto: Boolean(w?.photo_asset_id),
      signatureVariant: w?.signature_variant ?? "CORPORATE",
      publicCardEnabled: Boolean(w?.public_card_enabled),
    };
  });
}
