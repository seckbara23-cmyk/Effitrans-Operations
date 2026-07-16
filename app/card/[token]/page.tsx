import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveCardByToken } from "@/lib/brand/server/card-service";
import { BrandQrProvider } from "@/lib/brand/qr/provider";
import { PublicCard } from "@/components/brand/public-card";

// Public, per-request. Never prerendered (token-scoped, tenant-live).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const card = await resolveCardByToken(params.token);
  // Not indexed by default (X-Robots-Tag is also set in middleware).
  const robots = { index: false, follow: false } as const;
  if (!card) return { title: "Carte", robots };
  const title = `${card.employee.name} — ${card.company.name}`;
  return {
    title,
    description: card.employee.title ?? card.company.name,
    robots,
    openGraph: {
      title,
      description: card.employee.title ?? card.company.name,
      images: card.company.logoUrl ? [{ url: card.company.logoUrl }] : [],
    },
  };
}

export default async function CardPage({ params }: { params: { token: string } }) {
  const card = await resolveCardByToken(params.token);
  if (!card) notFound();
  const qrSvg = await BrandQrProvider.svg(card.profileUrl);
  return <PublicCard card={card} token={params.token} qrSvg={qrSvg} />;
}
