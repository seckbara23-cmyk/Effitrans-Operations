import "server-only";
/**
 * Is migration `20261021000005` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * CEO-ALIGNMENT WP1-E. The expiry-edit control writes through two definer RPCs
 * and reads the `document_expiry_change` history; neither exists before #161.
 * Until this says the table is there, the control is not drawn and the actions
 * refuse with `not_available` rather than reaching an RPC that does not exist.
 *
 * Same discipline as `lib/files/service-scope-140.ts`, for a TABLE rather than
 * a column: PostgREST reports an unknown relation as PGRST205 (« not in the
 * schema cache »; older releases surfaced Postgres' 42P01). Exactly those two
 * mean « not applied »; anything else is re-thrown, so a broken policy or a
 * connection fault is never mistaken for a missing migration.
 *
 * Zero rows, per request, no try/catch.
 *
 * DELETE THIS FILE once #161 is applied and stable. A compatibility shim that
 * outlives its window becomes a place where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgREST « relation not in the schema cache ». */
const UNDEFINED_RELATION_POSTGREST = "PGRST205";
/** PostgreSQL SQLSTATE for « relation does not exist ». */
const UNDEFINED_RELATION = "42P01";

export const expiryGovernanceAvailable = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("document_expiry_change" as never)
    .select("id")
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_RELATION_POSTGREST || error.code === UNDEFINED_RELATION) return false;
  throw new Error(`[documents] expiry-governance schema probe failed: ${error.message}`);
});
