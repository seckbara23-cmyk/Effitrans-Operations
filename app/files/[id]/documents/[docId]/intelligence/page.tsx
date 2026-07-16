import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getDocumentIntelligence } from "@/lib/docintel/service";
import { classFromTypeCode, docClassLabel, isDocClass, type DocClass } from "@/lib/docintel/types";
import { ReviewStudio } from "@/components/docintel/review-studio";

export const metadata: Metadata = { title: "Extraction intelligente" };
export const dynamic = "force-dynamic";

export default async function DocumentIntelligencePage({ params }: { params: { id: string; docId: string } }) {
  const header = <PageHeader meta="Documents · Intelligence" title="Extraction intelligente" subtitle="Classer, extraire, valider et appliquer — après revue humaine explicite." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "document:read")) notFound();

  const data = await getDocumentIntelligence(params.docId);
  if (!data || !data.document) notFound();

  const cls: DocClass = data.job?.declaredClass ?? classFromTypeCode(data.document.typeCode);
  const docClass = isDocClass(cls) ? cls : "UNKNOWN";

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/files/${params.id}`} className="text-teal-700 hover:underline">← Dossier {data.document.fileNumber ?? ""}</Link>
        <span className="text-slate-300">·</span>
        <span className="text-slate-600">{data.document.title ?? data.document.typeCode} · {docClassLabel(docClass)}</span>
      </div>

      <div className="surface p-4 text-sm">
        <p className="text-xs text-slate-500">Les valeurs extraites sont des <span className="font-medium">suggestions</span>. Aucune n&apos;est appliquée automatiquement : chaque champ approuvé est écrit via le service métier propriétaire (maritime / aérien), qui revérifie la permission.</p>
        {data.providers.some((p) => p.status === "unsupported") && (
          <p className="mt-1 text-xs text-amber-700">OCR / LLM non connectés (aucun contrat vérifié) — extraction déterministe / saisie manuelle uniquement.</p>
        )}
      </div>

      <ReviewStudio documentId={params.docId} job={data.job} candidates={data.candidates} docClass={docClass} canParsePdf={data.document.mimeType === "application/pdf"} />
    </div>
  );
}
