/**
 * Test double for React's `cache()` in the journey harness.
 * ---------------------------------------------------------------------------
 * `lib/authz/visibility.ts` (and other server-side readers) wrap lookups in
 * React's `cache()` for REQUEST-SCOPED MEMOISATION — an optimisation that
 * collapses repeated identical reads within one render. Outside a React render
 * there is no such scope and the import is not callable.
 *
 * Passing the function straight through preserves behaviour exactly and removes
 * only the memoisation, so the journey performs the real query every time —
 * stricter than production, never laxer, because no cached scope can mask a
 * visibility change mid-journey.
 *
 * Only `cache` is exported. The harness drives server-side business modules, not
 * components, so nothing here needs the rest of React; if a future journey slice
 * does import another React symbol, it will fail loudly rather than silently
 * receive undefined. (`export * from "react"` is not an option: `@types/react`
 * uses `export =`.)
 */
export function cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
