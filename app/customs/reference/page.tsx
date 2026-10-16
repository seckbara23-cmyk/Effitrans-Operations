/**
 * Customs Reference Library. CUSTOMS-REF-01A / REF-1.
 * ---------------------------------------------------------------------------
 * Reached from the Dédouanement workspace, the same way Customs Intelligence
 * is: this is a sub-surface of the customs department, not a top-level nav
 * entry, so the navigation model is untouched by this slice.
 *
 * The disclaimer is rendered unconditionally and before the list. « Present in
 * the library » and « currently in force » are different claims, and the
 * platform must never let the first be read as the second.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getLibrary } from "@/lib/customs/reference/service";
import { ReferenceLibraryPanel } from "@/components/customs/reference-library-panel";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.customs.reference.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function CustomsReferencePage() {
  const header = (
    <PageHeader
      meta="Dédouanement"
      title={t.customs.reference.title}
      subtitle={t.customs.reference.subtitle}
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>{t.customs.notConfigured}</Notice>
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:reference:read")) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>{t.customs.reference.forbidden}</Notice>
      </div>
    );
  }

  const { documents, canPublish } = await getLibrary();

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* Never optional, never collapsed, never below the fold. */}
      <div
        role="note"
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        {t.customs.reference.authorityDisclaimer}
      </div>

      <ReferenceLibraryPanel documents={documents} canPublish={canPublish} viewerId={user.id} />

      <p className="text-xs text-slate-500">
        <Link href="/customs" className="underline hover:no-underline">
          ← {t.customs.title}
        </Link>
      </p>
    </div>
  );
}
