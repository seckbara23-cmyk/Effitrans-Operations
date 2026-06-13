import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listAuditEntries } from "@/lib/audit/read";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.audit.title };

// Auth/RLS-dependent: never prerender at build.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface p-6 text-sm text-slate-600">{children}</div>
  );
}

export default async function AuditPage() {
  // Graceful in environments without Supabase configured (e.g. local mock).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.audit.title} subtitle={t.audit.subtitle} />
        <Notice>{t.audit.notConfigured}</Notice>
      </div>
    );
  }

  const user = await requireUser(); // redirects to /login if unauthenticated
  const permissions = await getEffectivePermissions(user.id);

  if (!hasPermission(permissions, "audit:read:all")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.audit.title} subtitle={t.audit.subtitle} />
        <Notice>{t.audit.forbidden}</Notice>
      </div>
    );
  }

  const entries = await listAuditEntries();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Administration" title={t.audit.title} subtitle={t.audit.subtitle} />

      {entries.length === 0 ? (
        <Notice>{t.audit.empty}</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.audit.columns.when}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.columns.action}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.columns.actor}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.columns.entity}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.columns.reason}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 tabular text-slate-600">{e.occurredAt}</td>
                  <td className="px-4 py-3 font-medium text-navy-900">{e.action}</td>
                  <td className="px-4 py-3 text-slate-600">{e.actorEmail ?? t.common.none}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {e.entity ?? t.common.none}
                    {e.entityId ? ` · ${e.entityId}` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{e.overrideReason ?? t.common.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
