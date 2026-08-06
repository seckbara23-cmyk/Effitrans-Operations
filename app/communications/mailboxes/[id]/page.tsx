import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getMailboxHealth } from "@/lib/ec/mailboxes/service";
import { listTriageQueue } from "@/lib/ec/triage/service";
import { TRIAGE_STATUS_FR, type TriageStatus } from "@/lib/ec/triage/model";
import { MailboxToggle } from "@/components/ec/mailbox-toggle";

export const metadata: Metadata = { title: "Boîte aux lettres" };
export const dynamic = "force-dynamic";

/**
 * EMP-1 — one mailbox: its configuration, its operational state, and the mail
 * it actually received.
 *
 * The recent-mail list reuses `listTriageQueue` with the mailbox filter rather
 * than reading `ec_inbound_message` directly. A message with no triage item
 * would be invisible here — which is correct, because EC-1 creates the triage
 * row in the same capture transaction, so a message without one would itself be
 * the anomaly rather than something this page should paper over.
 */
export default async function MailboxDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) notFound();

  const box = await getMailboxHealth(user.tenantId, params.id);
  if (!box) notFound();

  const canReadInbound = hasPermission(permissions, "communication:inbound:read");
  const recent = canReadInbound
    ? await listTriageQueue(user.tenantId, { mailboxId: box.id }, 25)
    : [];

  return (
    <div className="space-y-6">
      <Link href="/communications/mailboxes" className="text-sm text-teal-700 hover:underline">
        ← Boîtes aux lettres
      </Link>

      <PageHeader
        meta="Communications"
        title={box.address}
        subtitle={`${box.labelFr} · ${box.purpose}`}
      />

      <section className="surface p-4" aria-labelledby="emp1-mb-state">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="emp1-mb-state" className="mb-3 text-sm font-semibold text-navy-900">
              État
            </h2>
            <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Statut" value={box.isActive ? "Active" : "Inactive"} />
              <Fact label="Messages reçus" value={String(box.messageCount)} />
              <Fact label="En attente de tri" value={String(box.openCount)} />
              <Fact
                label="Dernier message"
                value={box.lastReceivedAt ? new Date(box.lastReceivedAt).toLocaleString("fr-FR") : "Jamais"}
              />
              <Fact label="Créée le" value={new Date(box.createdAt).toLocaleDateString("fr-FR")} />
              <Fact label="Modifiée le" value={new Date(box.updatedAt).toLocaleDateString("fr-FR")} />
            </dl>
            {box.note ? <p className="mt-3 text-xs text-slate-600">{box.note}</p> : null}
          </div>
          <MailboxToggle mailboxId={box.id} address={box.address} isActive={box.isActive} />
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          L&apos;adresse et l&apos;objet de la boîte ne sont pas modifiables ici. Les adresses sont
          uniques sur toute la plateforme — deux tenants revendiquant la même adresse rendraient le
          routage arbitraire — et leur création reste une opération d&apos;exploitation.
        </p>
      </section>

      <section className="surface overflow-hidden" aria-labelledby="emp1-mb-recent">
        <h2 id="emp1-mb-recent" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Messages récents
        </h2>
        {!canReadInbound ? (
          <p className="p-6 text-sm text-slate-500">
            La consultation du courrier entrant requiert une autorisation distincte.
          </p>
        ) : recent.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun message reçu sur cette adresse.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <Link href={`/communications/triage/${m.id}`} className="text-sm text-navy-900 hover:underline">
                  {m.subject ?? "(sans objet)"}
                </Link>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {m.fromAddress} · {new Date(m.receivedAt).toLocaleString("fr-FR")} ·{" "}
                  {TRIAGE_STATUS_FR[m.status as TriageStatus] ?? m.status}
                  {m.attachmentCount > 0 ? ` · ${m.attachmentCount} pièce(s) jointe(s)` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
