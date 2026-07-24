/**
 * Centre d'Opérations — honest section states (Phase 10.0C). Presentational.
 * ---------------------------------------------------------------------------
 * Four DISTINCT states, never conflated (Scope J):
 *   - empty        : the viewer is authorized and the section genuinely has nothing.
 *   - unavailable  : the feature/engine/migration is absent (dark), not zero.
 *   - (no data)    : a null section the page simply omits (no component rendered).
 *   - (no access)  : the page never fetched it (permission) — also omitted.
 * Only the first two render a placeholder; the other two are the page omitting
 * the section entirely. Internal errors/schema are never surfaced to users.
 */

/** Authorized, but truly nothing to show. */
export function CockpitEmptyState({ message }: { message: string }) {
  return <div className="surface p-6 text-sm text-slate-500">{message}</div>;
}

/** The feature is not active for this tenant (dark engine / migration absent). */
export function CockpitUnavailableState({ message }: { message: string }) {
  return (
    <div className="surface flex items-center gap-2 p-6 text-sm text-slate-500">
      <span aria-hidden className="text-slate-400">
        ○
      </span>
      <span>{message}</span>
    </div>
  );
}
