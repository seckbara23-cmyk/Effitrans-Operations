import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCommercialClients, listQuotationHandoffs } from "@/lib/commercial/service";
import { NewQuotationForm } from "@/components/commercial/new-quotation-form";

export const metadata: Metadata = { title: "Nouvelle demande de cotation" };
export const dynamic = "force-dynamic";

/**
 * EC-3C — open a quotation request. Requires `quotation:create`: a supervisor
 * who may only validate has no business preparing an offer, and the maker-checker
 * is the reason they must not.
 */
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams?: { triage?: string; client?: string };
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "quotation:create")) notFound();

  const clients = await listCommercialClients(user.tenantId);

  // A triage id from the query string is UNTRUSTED. It is honoured only if it
  // really is an unlinked HANDOFF_TO_QUOTATION in this tenant — otherwise a
  // crafted URL could attach a request to arbitrary correspondence.
  let triageItemId: string | null = null;
  let presetClientId: string | null = null;
  if (searchParams?.triage) {
    const handoffs = await listQuotationHandoffs(user.tenantId);
    const match = handoffs.find((h) => h.triageItemId === searchParams.triage && !h.alreadyLinked);
    if (match) {
      triageItemId = match.triageItemId;
      presetClientId = match.clientId;
    }
  }
  if (!presetClientId && searchParams?.client) {
    presetClientId = clients.some((c) => c.id === searchParams.client) ? searchParams.client : null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle demande de cotation"
        subtitle="Ouvre la demande puis son brouillon de cotation (version 1)."
      />
      <NewQuotationForm
        clients={clients}
        triageItemId={triageItemId}
        presetClientId={presetClientId}
      />
    </div>
  );
}
