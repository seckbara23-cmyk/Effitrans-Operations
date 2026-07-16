import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listWorkforceProfiles } from "@/lib/brand/server/service";
import { isDocumentType, type DocumentType } from "@/lib/brand/document/model";
import { TEMPLATE_REGISTRY } from "@/lib/brand/document/registry";
import { DocumentStudio } from "@/components/brand/document-studio";

export const metadata: Metadata = { title: "Document" };
export const dynamic = "force-dynamic";

export default async function DocumentTypePage({ params }: { params: { type: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const type = params.type.toUpperCase();
  if (!isDocumentType(type)) notFound();
  const template = TEMPLATE_REGISTRY[type as DocumentType];

  // The signature dropdown needs the workforce list (gated separately); empty if not held.
  const people = hasPermission(permissions, "admin:users:manage")
    ? (await listWorkforceProfiles()).map((p) => ({ userId: p.userId, name: p.name }))
    : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque · Modèles de documents" title={template.label} subtitle="Renseignez le contenu, prévisualisez le PDF, puis téléchargez en PDF ou DOCX." />
      <p className="text-sm"><Link href="/brand-center/documents" className="text-teal-700 hover:underline">← Modèles de documents</Link></p>
      <DocumentStudio template={template} people={people} today={today} />
    </div>
  );
}
