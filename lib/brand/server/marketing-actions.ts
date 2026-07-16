"use server";

/**
 * Marketing email generation (DBC-6). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gated by admin:config:manage (reused), tenant-scoped. Resolves branding once
 * (readBrandCore), builds the model, compiles portable HTML for the chosen ESP via the pure
 * compiler, validates the output, and returns it. NO sending, NO API, NO tracking. Audits
 * safe metadata only (type/provider) — never the HTML or content.
 */
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { buildMarketingModel, compileMarketingHtml, marketingReadiness, validateMarketingHtml, type MarketingInput } from "@/lib/brand/marketing/compiler";
import { isMarketingType, isEmailProvider, type EmailProvider } from "@/lib/brand/marketing/registry";
import type { BrandAssetView } from "./service";

function pickLogo(assets: BrandAssetView[]): BrandAssetView | null {
  const pub = assets.filter((a) => a.status === "PUBLISHED");
  return pub.find((a) => a.kind === "LOGO_EMAIL_PNG") ?? pub.find((a) => a.kind === "LOGO_PRIMARY") ?? null;
}

export type MarketingResult =
  | { ok: true; ready: true; html: string; filename: string }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "forbidden" | "invalid" | "compile_failed" };

export async function generateMarketingEmail(args: {
  input: MarketingInput; provider: string; intent: "preview" | "generate";
}): Promise<MarketingResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const { input } = args;
  if (!isMarketingType(input.type) || !isEmailProvider(args.provider) || !input.subject?.trim() || !input.headline?.trim()) {
    return { ok: false, error: "invalid" };
  }
  const provider = args.provider as EmailProvider;

  const core = await readBrandCore(admin.tenantId);
  const readiness = marketingReadiness(core.profile);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const logo = pickLogo(core.assets);
  const model = buildMarketingModel({
    marketing: { ...input, paragraphs: input.paragraphs.filter((p) => p.trim()) },
    companyName: core.displayName, profile: core.profile,
    logoUrl: logo?.publicUrl ?? null, logoAlt: logo?.altText ?? core.displayName,
  });
  const html = compileMarketingHtml(model, provider);
  if (!validateMarketingHtml(html).ok) return { ok: false, error: "compile_failed" };

  if (args.intent === "generate") {
    await writeAudit({
      action: AuditActions.BRAND_DOWNLOAD_GENERATED,
      actorId: admin.id, tenantId: admin.tenantId, entity: "brand_marketing", entityId: input.type,
      after: { type: input.type, provider }, // safe metadata; never the HTML
    });
  }
  return { ok: true, ready: true, html, filename: `email-${input.type.toLowerCase()}-${provider}.html` };
}
