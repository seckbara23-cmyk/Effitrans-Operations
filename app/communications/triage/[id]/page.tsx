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
  const [evidence, ledgerPage] = await Promise.all([
    getCaptureEvidence(user.tenantId, item.messageId),
    readDecisionPlane({ subject: { type: "ec_triage_item", id: params.id }, limit: 40 }),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Communications · Tri"
        title={item.subject ?? "(sans objet)"}
        subtitle={`Reçu le ${item.receivedAt.slice(0, 16).replace("T", " ")} — de ${item.fromName ?? item.fromAddress}`}
      />
      <Link href="/communications/triage" className="inline-block text-sm text-teal-700 hover:underline">
        ← File de tri
      </Link>

      <TriageStudio
        item={item}
        canTriage={canTriage}
        isSupervisor={roles.includes("OPS_SUPERVISOR")}
        currentUserId={user.id}
        dossiers={dossiers}
      />

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
