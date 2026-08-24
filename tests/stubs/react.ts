/**
 * Test double for React's `cache()` in the journey harness.
 * ---------------------------------------------------------------------------
 * `lib/authz/visibility.ts` and `lib/auth/current-user.ts` wrap reads in React's
 * `cache()` for REQUEST-SCOPED MEMOISATION — an optimisation that collapses
 * repeated identical lookups within one render. Outside a React render there is
 * no such scope and the import is not callable.
 *
 * Passing the function straight through preserves behaviour exactly and removes
 * only the memoisation: the journey therefore executes the real query every
 * time, which is if anything a STRICTER test than production (no stale cached
 * scope can mask a visibility change mid-journey). Everything else from React is
 * re-exported untouched.
 */
export * from "react";

export function cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
