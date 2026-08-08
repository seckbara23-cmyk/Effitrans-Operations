import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listMailboxSummaries } from "@/lib/ec/mailboxes/membership";
import { BulkAssignPanel } from "@/components/ec/bulk-assign-panel";

export const metadata: Metadata = { title: "Attribution en masse" };
export const dynamic = "force-dynamic";

/**
 * Administration → Utilisateurs → Enterprise Mail → Attribution en masse.
 *
 * Preview-first by construction. The page renders no execute control until a
 * preview exists, and the server refuses execution whose fingerprint does not
 * match a preview it just recomputed — so the guarantee holds even for a caller
 * that never renders this page.
 *
 * Gated on `communication:membership:manage` alone: bulk assignment grants
 * access, it does not create mailboxes.
 */
export default async function BulkAssignPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:membership:manage")) notFound();

  const mailboxes = (await listMailboxSummaries(user.tenantId))
    .filter((m) => m.mailboxType === "SHARED");

  return (
    <div className="animate-fade-in space-y-6">
      <Link href="/users/enterprise-mail" className="inline-block text-sm text-teal-700 hover:underline">
        ← Enterprise Mail
      </Link>

      <PageHeader
        meta="Administration · Enterprise Mail"
        title="Attribution en masse"
        subtitle="Aperçu obligatoire avant toute écriture."
      />

      {mailboxes.length === 0 ? (
        <p className="surface p-6 text-sm text-slate-500">
          Aucune boîte partagée n&apos;est réservée. Réservez-en une avant d&apos;attribuer des
          accès.
        </p>
      ) : (
        <BulkAssignPanel mailboxes={mailboxes} />
      )}
    </div>
  );
}
