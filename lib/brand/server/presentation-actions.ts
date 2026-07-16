"use server";

/**
 * Presentation + communication generation (DBC-5). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gated by admin:config:manage (reused), tenant-scoped. Resolves branding ONCE from the
 * Brand Center (readBrandCore) and runs the pure builders: an editable PPTX (OOXML) + SVG
 * slide previews for the deck, and SVG masters for LinkedIn/social. Refuses when brand
 * completeness is insufficient. Audits SAFE metadata only — never the generated content.
 */
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { buildCorporateDeck, presentationReadiness, buildCommunicationModel, type DeckInput } from "@/lib/brand/presentation/model";
import { renderSlideSvg, renderCommunicationSvg } from "@/lib/brand/presentation/svg";
import { buildPptx } from "@/lib/brand/pptx/ooxml";
import { COMMUNICATION_META, isCommunicationKind, isPresentationType, type CommunicationKind } from "@/lib/brand/presentation/registry";

export type DeckResult =
  | { ok: true; ready: true; slidesSvg: string[]; pptxBase64: string; filename: string }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "forbidden" | "invalid" };

export async function generateDeck(input: DeckInput, intent: "preview" | "generate"): Promise<DeckResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!isPresentationType(input.presentationType) || !input.title?.trim()) return { ok: false, error: "invalid" };

  const core = await readBrandCore(admin.tenantId);
  const readiness = presentationReadiness(core.profile);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const deck = buildCorporateDeck({ deck: input, companyName: core.displayName, profile: core.profile, memberships: core.memberships });
  const total = deck.slides.length;
  const slidesSvg = deck.slides.map((s, i) => renderSlideSvg(s, deck.brand, i, total));
  const pptxBase64 = Buffer.from(buildPptx(deck)).toString("base64");

  await writeAudit({
    action: intent === "generate" ? AuditActions.BRAND_PRESENTATION_GENERATED : AuditActions.BRAND_PRESENTATION_PREVIEWED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "brand_presentation", entityId: input.presentationType,
    // safe metadata; never the slides or the PPTX
    after: { type: input.presentationType, slides: total },
  });

  return { ok: true, ready: true, slidesSvg, pptxBase64, filename: `presentation-${input.presentationType.toLowerCase()}.pptx` };
}

export async function recordPresentationDownload(type: string): Promise<{ ok: boolean }> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false }; }
  await writeAudit({ action: AuditActions.BRAND_PRESENTATION_DOWNLOADED, actorId: admin.id, tenantId: admin.tenantId, entity: "brand_presentation", entityId: type, after: { type } });
  return { ok: true };
}

export type CommResult =
  | { ok: true; ready: true; svg: string; filename: string }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "forbidden" | "invalid" };

export async function generateCommunication(input: {
  kind: string; headline: string; subline?: string | null; personName?: string | null; personTitle?: string | null; intent: "preview" | "generate";
}): Promise<CommResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!isCommunicationKind(input.kind) || !input.headline?.trim()) return { ok: false, error: "invalid" };
  const kind = input.kind as CommunicationKind;

  const core = await readBrandCore(admin.tenantId);
  const readiness = presentationReadiness(core.profile);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const meta = COMMUNICATION_META[kind];
  const model = buildCommunicationModel({
    kind, width: meta.width, height: meta.height, companyName: core.displayName, profile: core.profile,
    headline: input.headline, subline: input.subline ?? null,
    person: kind === "CEO_BANNER" && input.personName ? { name: input.personName, title: input.personTitle ?? null } : null,
  });
  const svg = renderCommunicationSvg(model);

  if (input.intent === "generate") {
    await writeAudit({
      action: AuditActions.BRAND_COMMUNICATION_GENERATED,
      actorId: admin.id, tenantId: admin.tenantId, entity: "brand_communication", entityId: kind,
      after: { kind }, // safe metadata; never the content
    });
  }
  return { ok: true, ready: true, svg, filename: `${kind.toLowerCase()}.svg` };
}
