/**
 * Test double for `next/cache`. Outside a Next request context `revalidatePath`
 * throws, and cache invalidation is not a business rule — it is presentation
 * plumbing. Stubbing it lets the REAL server actions run unchanged in the
 * journey harness while every authority, gate and audit stays real.
 *
 * Calls are recorded so the journey can assert that an action revalidated the
 * surfaces it claims to, rather than silently swallowing them.
 */
export const revalidatedPaths: string[] = [];
export const revalidatedTags: string[] = [];

export function revalidatePath(path: string): void {
  revalidatedPaths.push(path);
}

export function revalidateTag(tag: string): void {
  revalidatedTags.push(tag);
}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
