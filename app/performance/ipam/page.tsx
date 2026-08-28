import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { IndicatorUnavailable } from "@/components/performance/indicator-unavailable";
import { INDICATOR_READINESS } from "@/lib/performance/read";

export const metadata: Metadata = { title: "IPAM" };
export const dynamic = "force-dynamic";

export default function IpamPage() {
  const readiness = INDICATOR_READINESS.find((r) => r.indicator === "IPAM")!;
  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="IPAM — Indice de Performance Account Manager"
        subtitle="Méthode figée ; sources pas encore collectées."
      />
      <IndicatorUnavailable
        indicator="IPAM"
        fullName="Indice de Performance Account Manager"
        proven="La méthode est vérifiée : cinq dimensions pondérées 25/25/20/20/10, toutes requises, avec leurs sous-pondérations. L'exemple de la note de méthode reproduit exactement (86,70)."
        missing={readiness.missing}
      />
    </div>
  );
}
