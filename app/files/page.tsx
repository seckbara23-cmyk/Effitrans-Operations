import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listFiles } from "@/lib/files/service";
import { listClients } from "@/lib/clients/service";
import { FilesTable } from "@/components/files/files-table";
import { FilesFilters } from "@/components/files/files-filters";
import { t } from "@/lib/i18n";
import type { FileFilterCriteria, FileSortKey } from "@/lib/files/types";

export const metadata: Metadata = { title: t.files.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FilesPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Opérations" title={t.files.title} subtitle={t.files.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.forbidden}</Notice></div>;
  }

  const sp = searchParams ?? {};
  const criteria: FileFilterCriteria = {
    search: one(sp.search),
    status: one(sp.status) as FileFilterCriteria["status"],
    type: one(sp.type) as FileFilterCriteria["type"],
    priority: one(sp.priority) as FileFilterCriteria["priority"],
    clientId: one(sp.client),
    transportMode: one(sp.mode) as FileFilterCriteria["transportMode"],
    mine: one(sp.mine) === "1",
    overdue: one(sp.overdue) === "1",
    sort: (one(sp.sort) as FileSortKey | undefined) ?? "newest",
  };

  const [files, clients] = await Promise.all([
    listFiles(criteria),
    hasPermission(permissions, "client:read")
      ? listClients().then((cs) => cs.map((c) => ({ id: c.id, name: c.name })))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // Quick-filter pills compose on top of the current params (toggle on/off).
  const pills: { key: keyof typeof t.files.pills; param: string; value: string }[] = [
    { key: "mine", param: "mine", value: "1" },
    { key: "overdue", param: "overdue", value: "1" },
    { key: "import", param: "type", value: "IMP" },
    { key: "export", param: "type", value: "EXP" },
    { key: "highPriority", param: "priority", value: "high" },
  ];
  const pillHref = (param: string, value: string, active: boolean) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (val) next.set(k, val);
    }
    if (active) next.delete(param);
    else next.set(param, value);
    const qs = next.toString();
    return qs ? `/files?${qs}` : "/files";
  };

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      <FilesFilters
        clients={clients}
        current={{
          search: criteria.search,
          status: criteria.status,
          type: criteria.type,
          priority: criteria.priority,
          client: criteria.clientId,
          mode: criteria.transportMode,
          sort: criteria.sort,
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {pills.map((p) => {
          const active = Boolean(
            one(sp[p.param]) === p.value ||
              (p.param === "mine" && criteria.mine) ||
              (p.param === "overdue" && criteria.overdue),
          );
          return (
            <Link
              key={p.key}
              href={pillHref(p.param, p.value, active)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-teal-500 bg-teal-50 text-teal-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
              }`}
            >
              {t.files.pills[p.key]}
            </Link>
          );
        })}
        <span className="ml-auto text-xs text-slate-500">
          {files.length} {t.files.filters.resultCount}
        </span>
      </div>

      <FilesTable files={files} canCreate={hasPermission(permissions, "file:create")} />
    </div>
  );
}
