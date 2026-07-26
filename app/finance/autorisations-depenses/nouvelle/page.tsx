/**
 * Nouvelle Autorisation de Dépenses (Phase 11.0C). SERVER.
 * ---------------------------------------------------------------------------
 * Server-gated on finance:expense:create; the createExpenseAuthorizationDraft
 * action re-asserts the same permission, so reaching this route without it
 * yields nothing either way.
 *
 * Creating leaves the document a DRAFT: no number is minted and no version is
 * frozen until submission (DEC-C14, the invoice-at-issuance precedent).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { AuthorizationForm } from "@/components/finance/expense/authorization-form";

export const metadata: Metadata = { title: "Nouvelle autorisation de dépenses" };
export const dynamic = "force-dynamic";

export default async function NewExpenseAuthorizationPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:expense:create")) notFound();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance · Autorisations de dépenses"
        title="Nouvelle autorisation"
        subtitle="Le document reste un brouillon : le numéro est attribué à la soumission."
        actions={
          <Link href="/finance/autorisations-depenses" className="text-sm text-slate-500 hover:text-navy-900">
            Retour au registre
          </Link>
        }
      />
      <AuthorizationForm mode="create" />
    </div>
  );
}
