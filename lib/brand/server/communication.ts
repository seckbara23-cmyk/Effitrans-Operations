import "server-only";

/**
 * The ONE communication resolver (Brand Center social hardening). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Both surfaces — the preview/SVG server action AND the PNG export route —
 * resolve their CommunicationModel HERE, so preview, SVG and PNG are always
 * built from the same input model. The caller authorizes first
 * (admin:config:manage) and passes its OWN tenantId from the session, never
 * from client input — the readBrandCore doctrine.
 *
 * THE LOGO IS THE APPROVED ONE OR NOTHING. pickSocialLogo only ever considers
 * PUBLISHED assets (the signature engine's rule): reversed (white) first —
 * these masters sit on the brand green — then primary, then the e-mail PNG.
 * The asset is fetched from the public bucket and embedded as a data URI so
 * the exported SVG is self-contained and the PNG rasterizer needs no network.
 * A DRAFT or archived logo can never leak into an export; no substitute is
 * ever hard-coded.
 */
import { readBrandCore, type BrandAssetView } from "./service";
import { buildCommunicationModel, presentationReadiness, pickSocialLogo, type CommunicationModel } from "@/lib/brand/presentation/model";
import { COMMUNICATION_META, isCommunicationKind, type CommunicationKind } from "@/lib/brand/presentation/registry";

async function toDataUri(asset: BrandAssetView): Promise<string | null> {
  try {
    const res = await fetch(asset.publicUrl);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    // 4 MB guard — a mis-uploaded giant asset must not balloon every export.
    if (bytes.length > 4 * 1024 * 1024) return null;
    return `data:${asset.mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export type CommunicationInput = {
  kind: string; headline: string; subline?: string | null;
  personName?: string | null; personTitle?: string | null;
};

export type ResolvedCommunication =
  | { ok: true; ready: true; model: CommunicationModel; kind: CommunicationKind }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "invalid" };

/** Validate input, read the brand ONCE, resolve the approved logo, build the model. */
export async function resolveCommunicationModel(tenantId: string, input: CommunicationInput): Promise<ResolvedCommunication> {
  if (!isCommunicationKind(input.kind) || !input.headline?.trim()) return { ok: false, error: "invalid" };
  const kind = input.kind as CommunicationKind;

  const core = await readBrandCore(tenantId);
  const readiness = presentationReadiness(core.profile);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const asset = pickSocialLogo(core.assets);
  const href = asset ? await toDataUri(asset) : null;

  const meta = COMMUNICATION_META[kind];
  const model = buildCommunicationModel({
    kind, width: meta.width, height: meta.height, companyName: core.displayName, profile: core.profile,
    logo: asset && href ? { href, alt: asset.altText || core.displayName } : null,
    headline: input.headline.trim(), subline: input.subline ?? null,
    person: kind === "CEO_BANNER" && input.personName ? { name: input.personName, title: input.personTitle ?? null } : null,
  });
  return { ok: true, ready: true, model, kind };
}
