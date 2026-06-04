import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CustomsExplorer } from "@/components/customs/customs-explorer";

export const metadata: Metadata = { title: "Dédouanement" };

export default function CustomsPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Dédouanement"
        subtitle="Suivi des déclarations, documents manquants, BAE, liquidations et dossiers en attente."
      />
      <CustomsExplorer />
    </div>
  );
}
