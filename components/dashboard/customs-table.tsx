import { customsQueue } from "@/lib/mock-data";
import { declarationStatus, priority } from "@/lib/status";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";

const c = t.dashboard.columns;

export function CustomsTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 font-semibold">{c.fileRef}</th>
            <th className="px-5 py-2.5 font-semibold">{c.declaration}</th>
            <th className="px-5 py-2.5 font-semibold">{c.missingDocs}</th>
            <th className="px-5 py-2.5 font-semibold">{c.officer}</th>
            <th className="px-5 py-2.5 font-semibold">{c.priority}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {customsQueue.map((f) => {
            const dec = declarationStatus[f.declaration];
            const prio = priority[f.priority];
            return (
              <tr
                key={f.reference}
                className="transition-colors hover:bg-sand-50"
              >
                <td className="tabular px-5 py-3 text-sm font-semibold text-navy-900">
                  {f.reference}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={dec.tone}>{dec.label}</Badge>
                </td>
                <td className="px-5 py-3">
                  {f.missingDocs.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Complet
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {f.missingDocs.map((d) => (
                        <span
                          key={d}
                          className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-100"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <AgentChip name={f.officer} />
                </td>
                <td className="px-5 py-3">
                  <Badge tone={prio.tone}>{prio.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
