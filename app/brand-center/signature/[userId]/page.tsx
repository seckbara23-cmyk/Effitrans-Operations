import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { compileEmployeeSignature } from "@/lib/brand/server/signature-actions";
import { listWorkforceProfiles } from "@/lib/brand/server/service";
import { SignatureStudio } from "@/components/brand/signature-studio";

export const metadata: Metadata = { title: "Signature e-mail" };
export const dynamic = "force-dynamic";

export default async function SignaturePage({ params }: { params: { userId: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:users:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }

  const people = await listWorkforceProfiles();
  const person = people.find((p) => p.userId === params.userId);
  if (!person) return <div className="surface p-6 text-sm text-slate-600">Collaborateur introuvable.</div>;

  // Server-compiled preview — React never generates the HTML.
  const initial = await compileEmployeeSignature(params.userId, "preview");

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque · Identité collaborateurs" title={`Signature — ${person.name}`} subtitle={`Variante : ${person.signatureVariant}. La signature est générée côté serveur à partir des données du Centre de marque.`} />
      <p className="text-sm"><Link href="/brand-center/people" className="text-teal-700 hover:underline">← Retour aux collaborateurs</Link></p>
      <SignatureStudio userId={person.userId} employeeName={person.name} variant={person.signatureVariant} initial={initial} />
    </div>
  );
}
