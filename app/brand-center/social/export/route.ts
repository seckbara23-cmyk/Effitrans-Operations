/**
 * Brand Center — social master PNG export. POST, admin:config:manage.
 * ---------------------------------------------------------------------------
 * Server-side rasterization of the governed template at EXACT template
 * dimensions — never a screenshot. The model comes from THE same resolver the
 * preview/SVG action uses (resolveCommunicationModel), so the three outputs
 * cannot drift; the tenant comes from the SESSION, never the body. Strictly a
 * brand-asset generator: no LinkedIn API, no posting, no scheduling.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { resolveCommunicationModel } from "@/lib/brand/server/communication";
import { renderCommunicationPng } from "@/lib/brand/presentation/png";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non autorisé", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return new NextResponse("admin:config:manage requis", { status: 403 });
  }

  let body: { kind?: string; headline?: string; subline?: string | null; personName?: string | null; personTitle?: string | null };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Requête invalide", { status: 400 });
  }

  const resolved = await resolveCommunicationModel(user.tenantId, {
    kind: body.kind ?? "", headline: body.headline ?? "",
    subline: body.subline ?? null, personName: body.personName ?? null, personTitle: body.personTitle ?? null,
  });
  if (!resolved.ok) return new NextResponse("Modèle ou titre invalide", { status: 400 });
  if (!resolved.ready) {
    return NextResponse.json({ ready: false, missing: resolved.missing }, { status: 409 });
  }

  const png = await renderCommunicationPng(resolved.model);

  await writeAudit({
    action: AuditActions.BRAND_COMMUNICATION_GENERATED,
    actorId: user.id, tenantId: user.tenantId, entity: "brand_communication",
    after: { kind: resolved.kind, format: "png" }, // safe metadata; never the content
  });

  return new NextResponse(Buffer.from(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${resolved.kind.toLowerCase()}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
