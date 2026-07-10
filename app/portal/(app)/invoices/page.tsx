import { listPortalInvoices } from "@/lib/portal/docs-service";
import { InvoiceCenter } from "@/components/portal/invoice-center";

export const dynamic = "force-dynamic";

export default async function PortalInvoicesPage() {
  const invoices = await listPortalInvoices();
  return (
    <div className="animate-fade-in">
      <InvoiceCenter invoices={invoices} />
    </div>
  );
}
