/**
 * Dashboard status + transport-mode breakdowns (Phase 1.5). Presentational —
 * derived from the FileOverview the page already fetched (file:read). Each row
 * deep-links into /files with the matching filter. Hidden when no overview.
 */
import Link from "next/link";
import type { FileOverview } from "@/lib/files/aggregate";
import type { FileStatus, TransportMode } from "@/lib/files/types";
import { t } from "@/lib/i18n";

const STATUSES: FileStatus[] = ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];

function Row({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
    >
      <span className="text-slate-600">{label}</span>
      <span className="tabular font-semibold text-navy-900">{value}</span>
    </Link>
  );
}

export function DashboardBreakdown({ overview }: { overview: FileOverview | null }) {
  if (!overview) return null;
  const o = t.dashboard.overview;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">{o.statusBreakdown}</h2>
        <div className="divide-y divide-slate-100">
          {STATUSES.map((s) => (
            <Row key={s} label={t.files.statuses[s]} value={overview.byStatus[s]} href={`/files?status=${s}`} />
          ))}
        </div>
      </section>

      <section className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">{o.modeBreakdown}</h2>
        <div className="divide-y divide-slate-100">
          {MODES.map((m) => (
            <Row key={m} label={t.files.modes[m]} value={overview.byMode[m]} href={`/files?mode=${m}`} />
          ))}
          {overview.byMode.none > 0 && (
            <Row label={o.modeNone} value={overview.byMode.none} href="/files" />
          )}
        </div>
      </section>
    </div>
  );
}
