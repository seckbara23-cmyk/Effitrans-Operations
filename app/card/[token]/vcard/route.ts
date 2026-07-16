/**
 * Public vCard download (DBC-3) — /card/{token}/vcard. No authentication (token capability).
 * Returns a spec-correct vCard 3.0 or a uniform 404. Not indexed.
 */
import { NextResponse } from "next/server";
import { resolveCardByToken } from "@/lib/brand/server/card-service";
import { buildVCard } from "@/lib/brand/card/vcard";

export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  return (name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 40) || "carte") + ".vcf";
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const card = await resolveCardByToken(params.token);
  if (!card) return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  const vcf = buildVCard(card);
  return new NextResponse(vcf, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(card.employee.name)}"`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "public, max-age=300",
    },
  });
}
