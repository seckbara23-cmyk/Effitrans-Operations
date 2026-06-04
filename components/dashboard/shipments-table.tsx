import { shipments } from "@/lib/mock-data";
import { shipmentStatus } from "@/lib/status";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { ModeTag } from "@/components/ui/mode-tag";
import { AgentChip } from "@/components/ui/agent-chip";

const c = t.dashboard.columns;

export function ShipmentsTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 font-semibold">{c.reference}</th>
            <th className="px-5 py-2.5 font-semibold">{c.customer}</th>
            <th className="px-5 py-2.5 font-semibold">{c.mode}</th>
            <th className="px-5 py-2.5 font-semibold">{c.origin}</th>
            <th className="px-5 py-2.5 font-semibold">{c.destination}</th>
            <th className="px-5 py-2.5 font-semibold">{c.status}</th>
            <th className="px-5 py-2.5 font-semibold">{c.agent}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {shipments.map((s) => {
            const st = shipmentStatus[s.status];
            return (
              <tr
                key={s.reference}
                className="group transition-colors hover:bg-sand-50"
              >
                <td className="px-5 py-3">
                  <div className="tabular text-sm font-semibold text-navy-900">
                    {s.reference}
                  </div>
                  {s.container && (
                    <div className="tabular text-[11px] text-slate-400">
                      {s.container}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-navy-800">{s.customer}</td>
                <td className="px-5 py-3">
                  <ModeTag mode={s.mode} />
                </td>
                <td className="px-5 py-3 text-sm text-slate-600">{s.origin}</td>
                <td className="px-5 py-3 text-sm text-slate-600">
                  {s.destination}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td className="px-5 py-3">
                  <AgentChip name={s.agent} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
