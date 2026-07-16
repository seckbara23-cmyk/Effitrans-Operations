import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAttentionQueue } from "@/lib/shipping/intelligence/manage-service";

export const metadata: Metadata = { title: "Alertes maritimes" };
export const dynamic = "force-dynamic";
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }
const SEV: Record<string, string> = { critical: "bg-red-50 text-red-700", warning: "bg-amber-50 text-amber-700", info: "bg-slate-100 text-slate-600" };

export default async function ShippingAlertsPage() {
  const header = <PageHeader meta="Maritime" title="File d'attention" subtitle="Alertes dérivées de faits réels (pas d'e-mail/SMS). Lecture seule." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;

  const queue = await getAttentionQueue();

  return (
    <div className="animate-fade-in space-y-4">
      {header}
      {queue.length === 0 ? <Notice>Aucune alerte active.</Notice> : (
        <div className="space-y-3">
          {queue.map((q) => (
            <div key={q.shipmentId} className="surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Link href={`/shipping/shipments/${q.shipmentId}`} className="tabular font-medium text-teal-700 hover:underline">{q.fileNumber ?? "—"}</Link>
                <span className="text-xs text-slate-500">{q.clientName ?? "—"}</span>
                <span className="ml-auto text-xs text-slate-500">{q.milestoneLabel}</span>
              </div>
              <ul className="space-y-1">
                {q.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEV[a.severity]}`}>{a.severity}</span>
                    <span className="text-slate-700">{a.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
