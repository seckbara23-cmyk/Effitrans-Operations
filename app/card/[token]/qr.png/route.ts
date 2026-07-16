/**
 * Public QR PNG download (DBC-3) — /card/{token}/qr.png. No authentication.
 * The QR encodes the public card URL only (never contact data), so it survives every
 * profile change and dies only when the token is rotated. Uniform 404. Not indexed.
 */
import { NextResponse } from "next/server";
import { resolveCardByToken } from "@/lib/brand/server/card-service";
import { BrandQrProvider } from "@/lib/brand/qr/provider";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const card = await resolveCardByToken(params.token);
  if (!card) return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  const png = await BrandQrProvider.png(card.profileUrl);
  return new NextResponse(Buffer.from(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qr.png"`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "public, max-age=300",
    },
  });
}
