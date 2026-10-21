import "server-only";
/**
 * Is migration `20261021000004` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * CEO-ALIGNMENT WP1-D. Filing a customer's instructing message writes
 * `document.source_message_id` and relies on its partial UNIQUE index for
 * idempotency. Against a schema without that column the insert would fail
 * AFTER the rendition was uploaded, so the action is not offered — and not
 * accepted — until this says the column exists. Migrations 157–161 apply in
 * one governed run, so the `ORDRE_DE_TRANSIT` type (#159) is present whenever
 * this column is.
 *
 * Same shape as `lib/files/service-scope-140.ts`: one column, one SQLSTATE,
 * zero rows, per request, no try/catch.
 *
 * DELETE THIS FILE once #160 is applied and stable. A compatibility shim that
 * outlives its window becomes a place where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgreSQL SQLSTATE for « column does not exist ». */
const UNDEFINED_COLUMN = "42703";

export const messageProvenanceStored = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("document")
    .select("source_message_id" as never)
    // ZERO rows: the projection is validated before anything is fetched.
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_COLUMN) return false;
  throw new Error(`[ec] message-provenance schema probe failed: ${error.message}`);
});
