/**
 * EC-2 — triage detail. Gate: communication:inbound:read; acting needs
 * communication:triage; reassignment additionally needs OPS_SUPERVISOR.
 *
 * The dossier list offered for attachment is SCOPED TO WHAT THIS USER MAY READ
 * (resolveFileScope) — a triager cannot attach correspondence to a dossier they
 * are not authorized to see, and the action re-checks it server-side.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getUserRoleCodes } from "@/lib/workflow/access/roles";
import { getTriageDetail } from "@/lib/ec/triage/service";
import { listFiles } from "@/lib/files/service";
import { TriageStudio } from "@/components/ec/triage-studio";
import { MessageEvidence } from "@/components/ec/message-evidence";
import { getCaptureEvidence } from "@/lib/ec/mailboxes/service";
import { readDecisionPlane } from "@/lib/unified-timeline/decision-plane";
import { AttachmentIngest } from "@/components/ec/attachment-ingest";
import { lookupIngestedDocument } from "@/lib/ec/ingest/actions";
import { listDocumentTypes } from "@/lib/documents/service";

export const metadata: Metadata = { title: "Message entrant — tri" };
export const dynamic = "force-dynamic";

export default async function TriageDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:inbound:read")) notFound();
  const canTriage = hasPermission(permissions, "communication:triage");
  const roles = await getUserRoleCodes(user.id, user.tenantId);

  const item = await getTriageDetail(user.tenantId, params.id);
  if (!item) notFound();

  // Only dossiers this user may read are offered — listFiles applies
  // resolveFileScope, and the action re-validates with isFileVisible. A triager
  // without file:read simply gets no picker rather than an error page.
  const dossiers = canTriage && hasPermission(permissions, "file:read")
    ? (await listFiles({})).map((f) => ({
        id: f.id,
        label: `${f.fileNumber}${f.clientName ? ` — ${f.clientName}` : ""}`,
      }))
    : [];

  // EMP-1 — the evidence panel. Both reads go through RLS: the capture journal
  // under the EC policies, the ledger under the subject-based
  // `business_event_select` policy added at UT-1. Neither needs a new gate, and
  // adding one would have been a second copy of a rule that already exists.
  const [evidence, ledgerPage, documentTypes] = await Promise.all([
    getCaptureEvidence(user.tenantId, item.messageId),
    readDecisionPlane({ subject: { type: "ec_triage_item", id: params.id }, limit: 40 }),
    // EMP-4 — the type must be chosen by a person; an email attachment has none.
    hasPermission(permissions, "document:create") ? listDocumentTypes() : Promise.resolve([]),
  ]);

  // EMP-4 — ingestion needs BOTH authorities, and the dossier list is already
  // scoped to what this user may read (the picker above uses resolveFileScope).
  const canIngest =
    hasPermission(permissions, "document:create") && hasPermission(permissions, "communication:inbound:read");
  const ingestState = canIngest
    ? await Promise.all(
        item.attachments.map(async (a) => ({
          id: a.id,
          ingested: await lookupIngestedDocument(a.id),
        })),
      )
    : [];
  const ingestedByAttachment = new Map(ingestState.map((s) => [s.id, s.ingested]));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Communications · Tri"
        title={item.subject ?? "(sans objet)"}
        subtitle={`Reçu le ${item.receivedAt.slice(0, 16).replace("T", " ")} — de ${item.fromName ?? item.fromAddress}`}
      />
      <div className="flex flex-wrap gap-4">
        <Link href="/communications/triage" className="text-sm text-teal-700 hover:underline">
          ← File de tri
        </Link>
        {/* EMP-2 — the conversation this message belongs to. Keyed on the message
            row, because the thread identity is derived rather than stored. */}
        <Link href={`/communications/threads/${item.messageId}`} className="text-sm text-teal-700 hover:underline">
          Voir la conversation →
        </Link>
        {/* EMP-3 — reply. The composer derives recipients and RFC headers from
            the ORIGINAL message's stored evidence; nothing is passed through
            the URL except which message is being answered. */}
        {hasPermission(permissions, "communication:read") ? (
          <>
            <Link
              href={`/communications/compose?reply=${item.messageId}`}
              className="text-sm text-teal-700 hover:underline"
            >
              Répondre
            </Link>
            <Link
              href={`/communications/compose?reply=${item.messageId}&all=1`}
              className="text-sm text-teal-700 hover:underline"
            >
              Répondre à tous
            </Link>
          </>
        ) : null}
      </div>

      <TriageStudio
        item={item}
        canTriage={canTriage}
        isSupervisor={roles.includes("OPS_SUPERVISOR")}
        currentUserId={user.id}
        dossiers={dossiers}
      />

      {/* EMP-4 — attachment ingestion. Rendered here rather than inside the
          triage studio: EC-2 guarantees its own surfaces create nothing
          automatically, and that guarantee is worth more than the convenience
          of co-locating the control. */}
      {canIngest && item.attachments.length > 0 ? (
        <section className="surface p-4" aria-labelledby="emp4-ingest">
          <h2 id="emp4-ingest" className="mb-3 text-sm font-semibold text-navy-900">
            Pièces jointes — rattachement au dossier
          </h2>
          <ul className="space-y-3">
            {item.attachments.map((a) => (
              <li key={a.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <p className="text-sm text-navy-900">{a.filename}</p>
                <AttachmentIngest
                  attachmentId={a.id}
                  filename={a.filename}
                  stored={a.stored}
                  alreadyIngested={ingestedByAttachment.get(a.id) ?? null}
                  dossiers={dossiers}
                  documentTypes={documentTypes.map((t) => ({ code: t.code, label: t.labelFr ?? t.code }))}
                  canIngest={canIngest}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            Le rattachement copie la pièce jointe dans le dossier. Le message capturé reste
            inchangé : il est la preuve de ce qui a été reçu. Aucune analyse automatique
            n&apos;est déclenchée.
          </p>
        </section>
      ) : null}

      <MessageEvidence
        evidence={evidence}
        ledger={ledgerPage.entries.map((e) => ({
          id: e.eventId,
          eventType: e.eventType,
          occurredAt: e.occurredAt,
        }))}
        linkedFileId={item.outcomeFileId}
        linkedFileLabel={
          item.outcomeFileId
            ? (dossiers.find((d) => d.id === item.outcomeFileId)?.label ?? null)
            : null
        }
      />
    </div>
  );
}
