import Link from "next/link";
import { cn } from "@/lib/cn";

/** Compact department dashboard card. Server-safe (no client state). */
const TONE: Record<string, string> = {
  navy: "before:bg-navy-700",
  teal: "before:bg-teal-600",
  amber: "before:bg-amber-500",
  red: "before:bg-red-500",
  slate: "before:bg-slate-400",
};

export function StatCard({
  label,
  value,
  tone = "navy",
  href,
}: {
  label: string;
  value: string | number;
  tone?: keyof typeof TONE;
  href?: string;
}) {
  const cls = cn(
    "surface relative overflow-hidden p-4 before:absolute before:inset-y-0 before:left-0 before:w-1",
    TONE[tone] ?? TONE.navy,
    href && "block transition-shadow hover:shadow-card-hover",
  );
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 tabular text-2xl font-bold text-navy-900">{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
