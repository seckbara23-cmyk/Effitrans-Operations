import { listPlatformAuditEvents } from "@/lib/platform/audit-read";

export const dynamic = "force-dynamic";

export default async function PlatformAudit() {
  const events = await listPlatformAuditEvents();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Journal plateforme</h1>
        <p className="mt-1 text-sm text-slate-400">Actions d&apos;administration de la plateforme (journal partagé, espace de noms platform.*).</p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-slate-400">
          Aucune action de plateforme enregistrée pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/5 text-left text-[12px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Tenant cible</th>
                <th className="px-4 py-3 font-semibold">Entité</th>
                <th className="px-4 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-[13px] text-teal-200">{e.action}</td>
                  <td className="px-4 py-3 text-slate-400">{e.tenantId ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{e.entity ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{e.occurredAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
