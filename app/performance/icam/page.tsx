import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { IndicatorUnavailable } from "@/components/performance/indicator-unavailable";
import { INDICATOR_READINESS } from "@/lib/performance/read";

export const metadata: Metadata = { title: "ICAM" };
export const dynamic = "force-dynamic";

export default function IcamPage() {
  const readiness = INDICATOR_READINESS.find((r) => r.indicator === "ICAM")!;
  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="ICAM — Indicateur de Charge Account Manager"
        subtitle="Méthode figée ; sources pas encore collectées."
      />
      <IndicatorUnavailable
        indicator="ICAM"
        fullName="Indicateur de Charge Account Manager"
        proven="La méthode est vérifiée au centime près : base 1,00 puis huit composantes plafonnées, plafond de 8,00 par dossier, population limitée aux dossiers clôturés. L'exemple de la note de méthode reproduit exactement (4,45)."
        missing={readiness.missing}
      />
    </div>
  );
}
