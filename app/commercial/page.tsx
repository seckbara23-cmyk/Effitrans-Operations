import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  listQuotations, listQuotationHandoffs, commercialCounts,
  COMMERCIAL_READ_PERMISSIONS, QUOTATION_STATUS_FR,
} from "@/lib/commercial/service";
import { partition, visibleQueues, QUEUE_LABEL_FR } from "@/lib/commercial/queues";
import { readCommercialActivity } from "@/lib/workflow/events/readers";

export const metadata: Metadata = { title: "Commercial" };
export const dynamic = "force-dynamic";

/**
 * Commercial landing — EC-3C.
 *
 * ONE route per capability: this page IS the quotation list, organised by the
 * state a quotation is actually in, so there is no second "/commercial/quotations"
 * showing the same rows under a different heading.
 *
 * The queues are ROLE-SENSITIVE (lib/commercial/queues.ts). An agent sees the
 * preparation and customer-facing work; a supervisor sees what awaits validation
 * and what they have already decided. Nobody is shown a queue whose actions they
 * could not perform.
 */
export default async function CommercialPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  // The route does not exist for anyone outside the ratified matrix. 404 rather
  // than 403: an empty workspace would still confirm the module is here.
  if (!COMMERCIAL_READ_PERMISSIONS.some((p) => hasPermission(permissions, p))) notFound();

  const [quotations, handoffs, counts, activity] = await Promise.all([
    listQuotations(user.tenantId),
    listQuotationHandoffs(user.tenantId),
    commercialCounts(user.tenantId),
    readCommercialActivity(user.tenantId),
  ]);

  const buckets = partition(quotations);
  const queues = visibleQueues(permissions);
  const openHandoffs = handoffs.filter((h) => !h.alreadyLinked);
  const canCreate = hasPermission(permissions, "quotation:create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commercial"
        subtitle="Cotations : préparation, validation interne, envoi et acceptation client."
        actions={
          canCreate ? (
            <Link
              href="/commercial/quotations/new"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Nouvelle demande de cotation
            </Link>
          ) : null
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Demandes ouvertes" value={counts.openRequests} />
        <Stat label="En attente de validation" value={counts.pendingValidation} />
        <Stat label="En attente du client" value={counts.awaitingCustomer} />
        <Stat label="Acceptées, non converties" value={counts.acceptedNotConverted} />
      </section>

      {/* EC-2 handoffs. The handoff records INTENT and mints nothing: opening one
          is a deliberate act by an agent, which is what creates the request. */}
      {canCreate && openHandoffs.length > 0 ? (
        <section className="surface p-5">
          <h2 className="mb-1 text-base font-semibold text-navy-900">
            Orientations depuis le courrier entrant
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            Ces messages ont été orientés vers une demande de cotation lors du tri. Aucune
            cotation n&apos;a été créée : ouvrez-en une pour démarrer la demande.
          </p>
          <ul className="divide-y divide-slate-100">
            {openHandoffs.map((h) => (
              <li key={h.triageItemId} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-slate-700">
                  {h.clientName ?? "Client non identifié"}
                  <span className="ml-2 text-xs text-slate-400">
                    {h.recordedAt ? new Date(h.recordedAt).toLocaleDateString("fr-FR") : ""}
                  </span>
                </span>
                <Link
                  href={`/commercial/quotations/new?triage=${h.triageItemId}${h.clientId ? `&client=${h.clientId}` : ""}`}
                  className="text-navy-900 hover:underline"
                >
                  Ouvrir une demande
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {queues.map((key) => {
        const rows = buckets[key];
        return (
          <section key={key} className="surface p-5">
            <h2 className="mb-3 text-base font-semibold text-navy-900">
              {QUEUE_LABEL_FR[key]}{" "}
              <span className="text-sm font-normal text-slate-400">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune cotation dans cette file.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((q) => (
                  <li key={q.id} className="py-2">
                    <Link
                      href={`/commercial/quotations/${q.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm hover:underline"
                    >
                      <span className="font-medium text-navy-900">
                        {q.quotationNumber ?? "Brouillon"}{" "}
                        <span className="font-normal text-slate-500">v{q.version}</span>
                      </span>
                      <span className="text-slate-600">{q.clientName ?? "—"}</span>
                      <span className="text-xs text-slate-400">
                        {QUOTATION_STATUS_FR[q.status]} ·{" "}
                        {new Date(q.createdAt).toLocaleDateString("fr-FR")}
                      </span>
                    </Link>
                    {q.subject ? (
                      <p className="text-xs text-slate-500">{q.subject}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className="surface p-5">
        <h2 className="mb-3 text-base font-semibold text-navy-900">Activité commerciale récente</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun évènement enregistré.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-slate-700">{e.labelFr}</span>
                <span className="text-xs text-slate-400">
                  {new Date(e.occurredAt).toLocaleString("fr-FR")}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
    </div>
  );
}
