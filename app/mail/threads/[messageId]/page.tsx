import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getThreadForMessage } from "@/lib/ec/threads/service";
import { listTriageQueue } from "@/lib/ec/triage/service";
import { readDecisionPlane } from "@/lib/unified-timeline/decision-plane";
import { ThreadView } from "@/components/ec/thread-view";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

/**
 * EMP-2 — the read-only conversation view.
 *
 * The route is keyed on a MESSAGE row id, not on a thread id, and that is
 * deliberate. Conversation identity is derived rather than stored, so a thread
 * id is a computed value: putting one in a URL would publish a value that is
 * only meaningful relative to the messages currently captured. A message id is
 * a real, immutable row — so the link is stable even if the conversation later
 * grows or merges with another.
 *
 * Everything here is a read. There is no action, no form and no mutation.
 */
export default async function ThreadPage({ params }: { params: { messageId: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:inbound:read")) notFound();

  const thread = await getThreadForMessage(user.tenantId, params.messageId);
  if (!thread) notFound();

  // The triage rows for these messages give the routing outcome and the dossier
  // link. Reusing the queue reader keeps one definition of what an outcome is.
  const rowIds = new Set(thread.messages.map((m) => m.rowId));
  const triage = (await listTriageQueue(user.tenantId, {}, 400)).filter((t) => rowIds.has(t.messageId));

  // Correspondence events for every triage item in the conversation, read
  // through the Decision Plane under the UT-1 subject policy. No new stream.
  const ledgers = await Promise.all(
    triage.map(async (t) => ({
      messageId: t.messageId,
      entries: (await readDecisionPlane({ subject: { type: "ec_triage_item", id: t.id }, limit: 20 })).entries.map(
        (e) => ({ id: e.eventId, eventType: e.eventType, occurredAt: e.occurredAt }),
      ),
    })),
  );

  return (
    <div className="animate-fade-in space-y-6">
      <Link href="/mail/inbox" className="inline-block text-sm text-teal-700 hover:underline">
        ← Courrier entrant
      </Link>

      <PageHeader
        meta="Enterprise Mail · Conversation"
        title={thread.messages[0]?.subject ?? "(sans objet)"}
        subtitle={`${thread.messages.length} message${thread.messages.length > 1 ? "s" : ""} corrélé${
          thread.messages.length > 1 ? "s" : ""
        } par en-têtes RFC 5322`}
      />

      <ThreadView
        thread={thread}
        triage={triage.map((t) => ({
          messageId: t.messageId,
          triageId: t.id,
          status: t.status,
          outcome: t.outcome,
          outcomeFileId: t.outcomeFileId,
          attachmentCount: t.attachmentCount,
          mailboxAddress: t.mailboxAddress,
        }))}
        ledgers={ledgers}
        seedRowId={params.messageId}
      />
    </div>
  );
}
