/**
 * Test double for `lib/auth/current-user` — the journey harness's ONLY stub.
 * ---------------------------------------------------------------------------
 * Aliased in `vitest.journey.config.ts`. It answers "who is signed in" from the
 * harness's `actAs`, and nothing else: permissions, tenancy, visibility and
 * every business rule continue to be resolved from the real database by the
 * real code. `getStaffTenantBlockReason` and `getSessionClass` exist because
 * `requireUser` calls them on the signed-out path.
 */
import { currentIdentity } from "../journey/identity";
import type { CurrentUser } from "@/lib/auth/current-user";

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return currentIdentity();
}

export async function getStaffTenantBlockReason(): Promise<string | null> {
  return null;
}

export async function getSessionClass(): Promise<"staff" | "portal" | null> {
  return currentIdentity() ? "staff" : null;
}

export type { CurrentUser };
