import { cn } from "@/lib/cn";
import { buildTaskTimeline, type TaskRecord } from "@/lib/tasks";

const nodeTone: Record<string, string> = {
  done: "border-teal-600 bg-teal-600 text-white",
  current: "border-navy-700 bg-navy-700 text-white",
  "current-amber": "border-amber-500 bg-amber-500 text-white",
  "current-red": "border-red-500 bg-red-500 text-white",
  upcoming: "border-slate-300 bg-white text-slate-300",
};

export function TaskTimeline({ task }: { task: TaskRecord }) {
  const steps = buildTaskTimeline(task);

  return (
    <ol className="relative px-5 py-5">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const nodeKey =
          step.state === "current"
            ? step.tone === "red"
              ? "current-red"
              : step.tone === "amber"
                ? "current-amber"
                : "current"
            : step.state;
        return (
          <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast && (
              <span
                className={cn(
                  "absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5",
                  step.state === "done" ? "bg-teal-500" : "bg-slate-200",
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                nodeTone[nodeKey],
              )}
            >
              {step.state === "done" ? (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                  <path
                    d="m4 8.5 2.5 2.5L12 5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              {step.state === "current" && (
                <span
                  className={cn(
                    "absolute inset-0 animate-ping rounded-full opacity-30",
                    step.tone === "red"
                      ? "bg-red-400"
                      : step.tone === "amber"
                        ? "bg-amber-400"
                        : "bg-navy-500",
                  )}
                />
              )}
            </span>

            <div className="-mt-0.5 min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  step.state === "upcoming" ? "text-slate-400" : "text-navy-900",
                )}
              >
                {step.label}
              </p>
              <p className="tabular mt-0.5 text-xs text-slate-500">
                {step.date ?? (step.state === "upcoming" ? "À venir" : "—")}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
