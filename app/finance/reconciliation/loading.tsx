/**
 * Loading skeleton for the reconciliation view (Phase 1.17A). This route runs a
 * heavy multi-table aggregation; the skeleton avoids a blank screen on slow
 * loads. Mirrors the analytics skeleton style (animated slate placeholders).
 */
export default function Loading() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}
