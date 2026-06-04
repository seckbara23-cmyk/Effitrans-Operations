import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CustomersExplorer } from "@/components/customers/customers-explorer";

export const metadata: Metadata = { title: "Clients" };

export default function CustomersPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Clients"
        subtitle="Répertoire clients, contacts, dossiers ouverts et historique opérationnel."
      />
      <CustomersExplorer />
    </div>
  );
}
