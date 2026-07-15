/**
 * Platform Companies Console (Phase 6.0C). SERVER — platform only.
 * ---------------------------------------------------------------------------
 * The production management table. This server component enforces the platform
 * permission, loads the two bounded platform reads, and hands the already-safe rows
 * to the client console for search/filter/sort/paginate. The client receives no
 * fetch capability and no authority — only rows the server already chose to expose.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { loadConsoleRows } from "@/lib/platform/console/rows-server";
import { CompaniesConsole } from "@/components/platform/companies-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entreprises" };

export default async function PlatformCompanies() {
  await assertPlatformPermission("platform:companies:read");

  // Date.now() lives in the server component (not the pure logic) so trial math is
  // deterministic to test and computed once per request.
  const { rows } = await loadConsoleRows(Date.now());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Entreprises</h1>
          <p className="mt-1 text-sm text-slate-400">
            Console de gestion des tenants — {rows.length} entreprise(s).
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/platform/companies"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            Actualiser
          </Link>
          <Link
            href="/platform/companies/new"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400"
          >
            Nouvelle entreprise
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-12 text-center">
          <p className="text-lg font-semibold text-white">Aucune entreprise pour le moment</p>
          <p className="mt-1 text-sm text-slate-400">
            Provisionnez votre première société de logistique — sans SQL, sans script.
          </p>
          <Link
            href="/platform/companies/new"
            className="mt-4 inline-block rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400"
          >
            Nouvelle entreprise
          </Link>
        </div>
      ) : (
        <CompaniesConsole rows={rows} />
      )}
    </div>
  );
}
