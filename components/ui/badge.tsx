import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/status";

const toneClasses: Record<Tone, string> = {
  navy: "bg-navy-50 text-navy-700 ring-navy-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
};

const dotClasses: Record<Tone, string> = {
  navy: "bg-navy-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  green: "bg-emerald-500",
  slate: "bg-slate-400",
  blue: "bg-sky-500",
};

export function Badge({
  tone = "slate",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} />
      )}
      {children}
    </span>
  );
}
