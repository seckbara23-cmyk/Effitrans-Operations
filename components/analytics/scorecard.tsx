/**
 * Executive scorecard (Phase 1.13B). Server-safe, presentational, informational.
 */
import { t } from "@/lib/i18n";
import type { Scorecard } from "@/lib/analytics/executive";

function tone(score: number): string {
  if (score >= 80) return "text-teal-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-700";
}
function bar(score: number): string {
  if (score >= 80) return "bg-teal-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function Gauge({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular ${score == null ? "text-slate-400" : tone(score)}`}>
        {score == null ? "—" : `${score}%`}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${score == null ? "bg-slate-200" : bar(score)}`} style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  );
}

export function ExecutiveScorecard({ scorecard }: { scorecard: Scorecard }) {
  const s = t.analytics.exec.scorecard;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-navy-900">{s.title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Gauge label={s.operations} score={scorecard.operations} />
        <Gauge label={s.customs} score={scorecard.customs} />
        <Gauge label={s.transport} score={scorecard.transport} />
        <Gauge label={s.collections} score={scorecard.collections} />
        <div className="surface flex flex-col justify-center bg-navy-900 p-4 text-white">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-300">{s.overall}</p>
          <p className="mt-1 text-3xl font-bold tabular">{scorecard.overall}%</p>
        </div>
      </div>
    </section>
  );
}
