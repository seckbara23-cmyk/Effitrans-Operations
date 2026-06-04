import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentsExplorer } from "@/components/documents/documents-explorer";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Documents"
        subtitle="Suivi des pièces clients, documents transport, documents douane et documents manquants."
      />
      <DocumentsExplorer />
    </div>
  );
}
