/**
 * Centre d'Opérations — loading skeletons (Phase 10.0C, Scope J).
 * Suspense fallbacks matched to the streamed regions (the /analytics pattern).
 * Purely decorative — aria-hidden so assistive tech is not told about placeholder
 * boxes; a "Chargement…" live label carries the real status.
 */
function Box({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} aria-hidden />;
}

export function CockpitSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement du Centre d'opérations…
      </p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Box key={i} className="h-20" />
        ))}
      </div>
      <Box className="h-40" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Box className="h-48" />
        <Box className="h-48" />
      </div>
    </div>
  );
}

export function CockpitSupportingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement des sections complémentaires…
      </p>
      <Box className="h-56" />
      <Box className="h-40" />
    </div>
  );
}
