/**
 * Platform authorization boundary (Phase 4.0B-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The platform equivalent of lib/auth/require-permission, kept ENTIRELY separate
 * from tenant auth. Resolves the authenticated user → platform_admin (BY
 * auth.users.id — the authority, never an email lookup) → platform role →
 * platform permissions. There is NO inheritance to or from tenant roles.
 *
 * Reads go through the RLS-respecting server client: platform_admin's self-select
 * policy means the caller only ever resolves their OWN platform identity. A tenant
 * user (app_user / client_user) resolves to null here and can never gain platform
 * access; a platform admin has no app_user and cannot read tenant data via RLS.
 */
import "server-only";
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  hasPlatformPermission,
  isPlatformRole,
  platformPermissionsFor,
  type PlatformPermission,
  type PlatformRole,
} from "./roles";

export type PlatformUser = {
  /** platform_admin.id === auth.users.id */
  id: string;
  email: string;
  role: PlatformRole;
  permissions: PlatformPermission[];
};

export class PlatformAuthError extends Error {
  constructor(
    public code: "not_platform_admin" | "forbidden",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PlatformAuthError";
  }
}

/**
 * Resolve the current ACTIVE platform admin, or null. Request-scoped memoized
 * (React cache) so a platform render resolving the identity many times pays for
 * ONE platform_admin lookup.
 */
export const getPlatformUser = cache(async (): Promise<PlatformUser | null> => {
  const supabase = getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: pa } = await supabase
    .from("platform_admin")
    .select("id, email, platform_role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!pa || pa.status !== "active" || !isPlatformRole(pa.platform_role)) return null;

  return {
    id: pa.id,
    email: pa.email,
    role: pa.platform_role,
    permissions: [...platformPermissionsFor(pa.platform_role)],
  };
});

/** Require an active platform admin. Throws PlatformAuthError otherwise. */
export async function requirePlatformUser(): Promise<PlatformUser> {
  const user = await getPlatformUser();
  if (!user) throw new PlatformAuthError("not_platform_admin");
  return user;
}

/** Require a platform admin holding `code`. Returns the resolved platform user. */
export async function assertPlatformPermission(code: PlatformPermission): Promise<PlatformUser> {
  const user = await requirePlatformUser();
  if (!hasPlatformPermission(user.role, code)) {
    throw new PlatformAuthError("forbidden", `missing platform permission: ${code}`);
  }
  return user;
}

/** Capability check for routing / nav gating (is the caller a platform admin?). */
export async function isPlatformAdmin(): Promise<boolean> {
  return (await getPlatformUser()) !== null;
}
