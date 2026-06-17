import Link from "next/link";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { DossierLifecycle, Department, StepStatus } from "@/lib/files/lifecycle";

const DEPARTMENTS: Department[] = ["opening", "documentation", "customs", "transport", "finance", "archive"];

const DOT: Record<StepStatus, string> = {
  completed: "bg-teal-600",
  current: "bg-navy-900 ring-2 ring-navy-300",
  pending: "bg-slate-300",
  blocked: "bg-red-500",
  skipped: "border border-dashed border-slate-300 bg-transparent",
};

const TEXT: Record<StepStatus, string> = {
  completed: "text-navy-800",
  current: "font-semibold text-navy-900",
  pending: "text-slate-400",
  blocked: "font-medium text-red-700",
  skipped: "text-slate-300 line-through",
};

/**
 * Read-only dossier lifecycle tracker (Phase 2.0 addendum). Server component.
 * Desktop: department-grouped timeline (wraps horizontally). Mobile: vertical.
 * All state is DERIVED (lib/files/lifecycle) — no mutation here.
 */
export function LifecycleTracker({
  lifecycle,
  openHandoff,
}: {
  lifecycle: DossierLifecycle;
  openHandoff?: { title: string } | null;
}) {
  const L = t.lifecycle;
  const na = lifecycle.nextAction;
  const deptLabel = (d: DossierLifecycle["currentDepartment"]) => (d ? L.departments[d] : null);

  return (
    <div className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy-900">{L.title}</h2>
        <span className="text-xs font-medium text-slate-500">
          {lifecycle.completedPercent}% {L.percent}
        </span>
      </div>

      {/* current → next department + open handoff */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {lifecycle.currentDepartment && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 font-medium text-navy-800">
            {deptLabel(lifecycle.currentDepartment)}
          </span>
        )}
        {lifecycle.nextDepartment && (
          <>
            <span className="text-slate-400">→</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              {deptLabel(lifecycle.nextDepartment)}
            </span>
          </>
        )}
        {openHandoff && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
            {t.handoffs.openTask}: {openHandoff.title}
          </span>
        )}
      </div>

      {/* progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${lifecycle.completedPercent}%` }} />
      </div>

      {/* next action card */}
      <div
        className={cn(
          "rounded-lg border p-3",
          na ? (na.blocker ? "border-red-200 bg-red-50" : "border-teal-200 bg-teal-50/60") : "border-slate-200 bg-slate-50",
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{L.nextActionTitle}</p>
        {na ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-navy-900">{na.action}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {L.responsible} : {L.departments[na.department]}
                {na.blocker && <span className="ml-2 font-medium text-red-700">· {na.blocker}</span>}
              </p>
            </div>
            {na.href && (
              <Link href={na.href} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50">
                Ouvrir →
              </Link>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-600">{L.noAction}</p>
        )}
      </div>

      {/* department-grouped timeline */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
        {DEPARTMENTS.map((dept) => {
          const steps = lifecycle.steps.filter((s) => s.department === dept);
          if (steps.length === 0) return null;
          return (
            <div key={dept} className="rounded-lg border border-slate-100 bg-sand-50/40 p-3 lg:min-w-[150px] lg:flex-1">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {L.departments[dept]}
              </p>
              <ul className="space-y-1.5">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", DOT[s.status])} aria-hidden />
                    <span className="min-w-0">
                      <span className={cn("block text-xs leading-tight", TEXT[s.status])}>{s.label}</span>
                      {(s.status === "current" || s.status === "blocked") && (
                        <span className={cn("block text-[11px] leading-tight", s.status === "blocked" ? "text-red-600" : "text-slate-500")}>
                          {s.description}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
