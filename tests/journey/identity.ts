/**
 * THE ONE STUBBED BOUNDARY — authenticated session identity.
 * ---------------------------------------------------------------------------
 * The journey harness replaces exactly this: "who is logged in". Everything
 * downstream runs for real — `assertPermission` still resolves EFFECTIVE
 * permissions from the database for whichever identity is current, every server
 * action, the engine, the gates, RLS-mirroring visibility, the audit validator
 * and its writes, the document doctrine, Finance, custody, closure.
 *
 * Replacing the session rather than the permission check is deliberate: a stub
 * at `assertPermission` would let the journey "pass" while proving nothing about
 * authority, which is the one thing this suite exists to prove. Here, an actor
 * who lacks a permission is refused by the real RBAC lookup, exactly as in
 * production.
 */
import type { CurrentUser } from "@/lib/auth/current-user";

let current: CurrentUser | null = null;

/** Act as this identity until told otherwise. */
export function actAs(user: CurrentUser): void {
  current = user;
}

/** Nobody is signed in — used to prove anonymous refusal. */
export function actAsNobody(): void {
  current = null;
}

export function currentIdentity(): CurrentUser | null {
  return current;
}

/** Run `fn` as `user`, restoring the previous identity afterwards. */
export async function as<T>(user: CurrentUser, fn: () => Promise<T>): Promise<T> {
  const previous = current;
  current = user;
  try {
    return await fn();
  } finally {
    current = previous;
  }
}
