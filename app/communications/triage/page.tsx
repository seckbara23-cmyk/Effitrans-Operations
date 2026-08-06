/**
 * EC-2 — the triage queue. Gate: communication:inbound:read (granted to NOBODY
 * until RATIFY-EC1-1, so this page 404s for everyone today — the intended dark
 * state). Acting additionally requires communication:triage.
 *
 * Quarantined captures cannot appear here: they carry tenant_id = NULL and every
 * read is tenant-scoped. EC-1's meaning of quarantine is untouched.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getUserRoleCodes } from "@/lib/workflow/access/roles";
import {
  listTriageQueue, listMailboxes, triageCounts, filtersForView, isMailView, resolveDossierRef,
  MAIL_VIEWS, MAIL_VIEW_FR, type TriageFilters,
} from "@/lib/ec/triage/service";
import { QUARANTINE_VISIBILITY_NOTICE } from "@/lib/ec/mailboxes/service";
import { findByMessageId } from "@/lib/ec/threads/service";
import { redirect } from "next/navigation";
import { TRIAGE_STATUS_FR, TRIAGE_OUTCOME_FR, type TriageStatus } from "@/lib/ec/triage/model";

export const metadata: Metadata = { title: "Tri du courrier entrant" };
export const dynamic = "force-dynamic";

const STATUSES: TriageStatus[] = ["NEW", "ASSIGNED", "IN_REVIEW", "RESOLVED"];

export default async function TriageQueuePage({
  searchParams,
}: {
  searchParams?: {
    status?: string; mailbox?: string; sender?: string; from?: string; to?: string;
    mine?: string; unassigned?: string;
    view?: string; subject?: string; recipient?: string; dossier?: string; msgid?: string;
  };
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Communications" title="Tri du courrier entrant" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:inbound:read")) notFound();
  const canTriage = hasPermission(permissions, "communication:triage");
  const roles = await getUserRoleCodes(user.id, user.tenantId);
  const isSupervisor = roles.includes("OPS_SUPERVISOR");

  // EMP-1: the view supplies a BASE set of filters; anything the user typed is
  // layered on top and wins. A view is a starting point, not a cage.
  // EMP-2: a Message-ID identifies exactly one message, so searching for one is
  // a lookup, not a filter — it goes straight to that conversation. Resolved
  // through RLS, so an id from another tenant is simply not found.
  const msgid = searchParams?.msgid?.trim();
  if (msgid) {
    const hit = await findByMessageId(user.tenantId, msgid);
    if (hit) redirect(`/communications/threads/${hit}`);
  }

  const view = isMailView(searchParams?.view) ? searchParams.view : "inbox";
  // Resolved BEFORE the query, so an unmatched dossier number yields no rows
  // rather than quietly dropping the filter.
  const dossierRaw = searchParams?.dossier?.trim() || "";
  const dossierFilter = dossierRaw ? await resolveDossierRef(user.tenantId, dossierRaw) : null;
  const dossierUnmatched = Boolean(dossierRaw) && dossierFilter === null;
  const filters: TriageFilters = {
    ...filtersForView(view),
    status: STATUSES.includes(searchParams?.status as TriageStatus) ? (searchParams?.status as TriageStatus) : undefined,
    mailboxId: searchParams?.mailbox || undefined,
    sender: searchParams?.sender || undefined,
    subject: searchParams?.subject || undefined,
    recipient: searchParams?.recipient || undefined,
    fileId: dossierFilter ?? undefined,
    from: searchParams?.from || undefined,
    to: searchParams?.to || undefined,
    assignedTo: searchParams?.mine === "1" ? user.id : undefined,
    unassigned: searchParams?.unassigned === "1" || filtersForView(view).unassigned,
  };

  // Quarantine is unreachable by construction (EC-1's CHECK constraint keeps
  // tenant_id NULL), so the query is never issued rather than issued and
  // guaranteed to return nothing.
  const isQuarantine = view === "quarantine";
  const [items, mailboxes, counts] = await Promise.all([
    isQuarantine || dossierUnmatched ? Promise.resolve([]) : listTriageQueue(user.tenantId, filters),
    listMailboxes(user.tenantId),
    triageCounts(user.tenantId, user.id),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Communications"
        title="Tri du courrier entrant"
        subtitle="Chaque message capturé reçoit une décision — rattachement, cotation, correspondance ou rejet motivé."
      />
      <Link href="/communications" className="inline-block text-sm text-teal-700 hover:underline">
        ← Journal des communications
      </Link>

      {!canTriage && (
        <p className="surface p-4 text-sm text-slate-600">
          Vous pouvez consulter la file. <strong className="text-navy-800">Le tri est une autorité
          distincte</strong> (« communication:triage ») qui n&apos;est attribuée à aucun rôle tant que la
          ratification n&apos;a pas eu lieu.
        </p>
      )}

      {/* EMP-1 views. A vocabulary over the queue that already existed — each is
          a filter, not a separate inbox. */}
      <nav aria-label="Vues du courrier" className="flex flex-wrap gap-1.5">
        {MAIL_VIEWS.map((v) => (
          <Link
            key={v}
            href={`/communications/triage?view=${v}`}
            aria-current={view === v ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              view === v ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {MAIL_VIEW_FR[v]}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Non attribués" value={counts.unassigned} tone="amber" href="/communications/triage?unassigned=1" />
        <StatCard label="Qui me sont attribués" value={counts.assignedToMe} tone="teal" href="/communications/triage?mine=1" />
        <StatCard label="En cours d'examen" value={counts.inReview} tone="navy" href="/communications/triage?status=IN_REVIEW" />
        <StatCard
          label="Plus ancien en attente"
          value={counts.oldestOpenDays === null ? "—" : `${counts.oldestOpenDays} j`}
          tone={counts.oldestOpenDays !== null && counts.oldestOpenDays > 3 ? "red" : "slate"}
        />
      </div>

      {/* Filters — a GET form, so every view is a shareable URL. */}
      <form className="surface grid gap-2 p-4 sm:grid-cols-6" method="get">
        <input type="hidden" name="view" value={view} />
        <label className="sr-only" htmlFor="tstatus">Statut</label>
        <select id="tstatus" name="status" defaultValue={searchParams?.status ?? ""}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">— Tous les statuts —</option>
          {STATUSES.map((s) => <option key={s} value={s}>{TRIAGE_STATUS_FR[s]}</option>)}
        </select>

        <label className="sr-only" htmlFor="tmailbox">Boîte</label>
        <select id="tmailbox" name="mailbox" defaultValue={searchParams?.mailbox ?? ""}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">— Toutes les boîtes —</option>
          {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}</option>)}
        </select>

        <label className="sr-only" htmlFor="tsender">Expéditeur</label>
        <input id="tsender" name="sender" defaultValue={searchParams?.sender ?? ""} placeholder="Expéditeur"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="tsubject">Objet</label>
        <input id="tsubject" name="subject" defaultValue={searchParams?.subject ?? ""} placeholder="Objet"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="trecipient">Destinataire</label>
        <input id="trecipient" name="recipient" defaultValue={searchParams?.recipient ?? ""} placeholder="Destinataire"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="tmsgid">Message-ID</label>
        <input id="tmsgid" name="msgid" defaultValue="" placeholder="Message-ID"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="tdossier">Dossier</label>
        <input id="tdossier" name="dossier" defaultValue={searchParams?.dossier ?? ""} placeholder="N° de dossier"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="tfrom">Reçu depuis</label>
        <input id="tfrom" type="date" name="from" defaultValue={searchParams?.from ?? ""}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <label className="sr-only" htmlFor="tto">Reçu jusqu&apos;au</label>
        <input id="tto" type="date" name="to" defaultValue={searchParams?.to ?? ""}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />

        <button type="submit" className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white">
          Filtrer
        </button>
      </form>

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          {MAIL_VIEW_FR[view]} ({items.length})
        </h2>
        {msgid ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Aucun message lisible ne porte le Message-ID « {msgid} ».
          </p>
        ) : null}
        {dossierUnmatched ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Aucun dossier lisible ne porte le numéro « {dossierRaw} ». La recherche est limitée aux
            dossiers que vous êtes autorisé à consulter.
          </p>
        ) : null}
        {isQuarantine ? (
          <p className="rounded-lg border-l-2 border-dashed border-amber-300 bg-amber-50/40 p-4 text-sm text-amber-900">
            {QUARANTINE_VISIBILITY_NOTICE}
          </p>
        ) : null}
        {isQuarantine ? null : items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun message ne correspond à ces critères. Les messages non routables restent en quarantaine
            et n&apos;apparaissent dans aucune file : ils n&apos;appartiennent à aucun tenant.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2">Reçu</th><th>Expéditeur</th><th>Objet</th>
                  <th>Boîte</th><th>Statut</th><th>Décision</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100">
                    <td className="tabular py-2 text-xs text-slate-500">{i.receivedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-slate-700">{i.fromName ?? i.fromAddress}</td>
                    <td className="max-w-xs truncate font-medium text-navy-900">{i.subject ?? "(sans objet)"}</td>
                    <td className="text-xs text-slate-500">{i.mailboxAddress ?? "—"}</td>
                    <td className="text-slate-600">{TRIAGE_STATUS_FR[i.status]}</td>
                    <td className="text-xs text-slate-600">
                      {i.outcome ? TRIAGE_OUTCOME_FR[i.outcome] : "—"}
                      {i.attachmentCount > 0 && <span className="ml-1 text-slate-400">· {i.attachmentCount} PJ</span>}
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/communications/triage/${i.id}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-teal-300">
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isSupervisor && (
          <p className="mt-3 text-xs text-slate-500">
            En tant que superviseur, vous pouvez réattribuer un élément déjà attribué à une autre personne.
          </p>
        )}
      </section>
    </div>
  );
}
