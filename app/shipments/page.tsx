import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ShipmentsExplorer } from "@/components/shipments/shipments-explorer";

export const metadata: Metadata = { title: "Dossiers d'expédition" };

export default function ShipmentsPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Dossiers d'expédition"
        subtitle="Suivez les dossiers import/export, de la demande client jusqu'à la livraison."
      />
      <ShipmentsExplorer />
    </div>
  );
}
