import { listPortalDocuments } from "@/lib/portal/docs-service";
import { DocumentCenter } from "@/components/portal/document-center";

export const dynamic = "force-dynamic";

export default async function PortalDocumentsPage() {
  const documents = await listPortalDocuments();
  return (
    <div className="animate-fade-in">
      <DocumentCenter documents={documents} />
    </div>
  );
}
