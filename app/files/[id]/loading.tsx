/**
 * Loading skeleton for the operational-file detail view (Phase 1.17A). The page
 * fans out into many parallel queries (tasks, documents, customs, transport,
 * finance, communications); the skeleton avoids a blank screen while they load.
 */
export default function Loading() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
