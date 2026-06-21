import { t } from "@/lib/i18n";

/**
 * Department risk visibility card (Phase 3.1B). Server-safe, read-only.
 * Surfaces the department's risk-relevant signals — derived entirely from the
 * data the page already loaded (no new queries, no persistence).
 */
export type AttentionItem = {
  label: string;
  value: number | string;
  /** Highlight tone when the signal is active (non-zero). */
  tone?: "red" | "amber" | "teal";
};

const TONE: Record<string, string> = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  teal: "bg-teal-50 text-teal-700",
};

function isActive(v: number | string): boolean {
  return typeof v === "number" ? v > 0 : v !== "" && v !== "—";
}

export function DeptAttentionCard({ items }: { items: AttentionItem[] }) {
  const R = t.risk.dept;
  const anyActive = items.some((i) => isActive(i.value));

  return (
    <div className="surface p-5">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{R.title}</h2>
      {!anyActive ? (
        <p className="text-sm text-slate-500">{R.clear}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((it) => {
            const active = isActive(it.value);
            return (
              <div
                key={it.label}
                className={`rounded-lg px-3 py-2 ${active ? TONE[it.tone ?? "amber"] : "bg-slate-50 text-slate-400"}`}
              >
                <p className="text-xs font-medium">{it.label}</p>
                <p className="mt-1 tabular text-xl font-bold">{it.value}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
