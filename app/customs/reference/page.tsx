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
import { scanningAvailable } from "@/lib/customs/reference/scan";
import { ReferenceLibraryPanel } from "@/components/customs/reference-library-panel";
import { ReferenceSearch } from "@/components/customs/reference-search";
import { isReferenceCategory, isReferenceStatus } from "@/lib/customs/reference/types";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.customs.reference.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

/**
 * REF-2 — the search axes arrive as search parameters.
 *
 * Every one is re-read and re-validated here; the form is a convenience, not a
 * contract. `getLibrary` applies the viewer's permission itself, so a
 * hand-typed `?status=QUARANTINE` cannot widen what a plain reader sees.
 */
type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(v) ? v[0] : v;
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export default async function CustomsReferencePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
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

  const sp = (await searchParams) ?? {};
  const q = one(sp.q);
  const categoryParam = one(sp.category);
  const regime = one(sp.regime);
  const source = one(sp.source);
  const versionParam = one(sp.version);
  const statusParam = one(sp.status);
  const currentOnly = one(sp.currentOnly) === "1";

  // An unrecognised value is DROPPED rather than passed through: a typo in the
  // query string must narrow nothing, and must never reach a filter.
  const category = isReferenceCategory(categoryParam) ? categoryParam : undefined;
  const status = isReferenceStatus(statusParam) ? statusParam : undefined;
  const versionNumber = Number(versionParam);
  const version =
    Number.isInteger(versionNumber) && versionNumber > 0 ? versionNumber : undefined;

  const { documents, canPublish } = await getLibrary({
    q, category, regime, source, version, status, currentOnly,
  });

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

      <ReferenceSearch
        canPublish={canPublish}
        current={{ q, category, regime, source, version: versionParam, status, currentOnly }}
        resultCount={documents.length}
      />

      <ReferenceLibraryPanel
        documents={documents}
        canPublish={canPublish}
        viewerId={user.id}
        scannerConfigured={scanningAvailable()}
      />

      <p className="text-xs text-slate-500">
        <Link href="/customs" className="underline hover:no-underline">
          ← {t.customs.title}
        </Link>
      </p>
    </div>
  );
}
