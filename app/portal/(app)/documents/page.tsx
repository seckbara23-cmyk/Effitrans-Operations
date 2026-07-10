import { listPortalDocuments } from "@/lib/portal/docs-service";
import { DownloadCenter } from "@/components/portal/download-center";

export const dynamic = "force-dynamic";

export default async function PortalDocumentsPage() {
  const documents = await listPortalDocuments();
  return (
    <div className="animate-fade-in">
      <DownloadCenter documents={documents} />
    </div>
  );
}
