import "server-only";
/**
 * Is migration `20261021000002` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * CEO-ALIGNMENT WP1-B1/C. The same standing rule as `service-scope-140.ts`
 * (OPS-UAT-CONVERGENCE-01 §19):
 *
 *     APPLICATION DEPLOYMENT MUST NOT REQUIRE AN UNAPPLIED MIGRATION UNLESS
 *     THE MIGRATION IS GUARANTEED TO RUN FIRST.
 *
 * Vercel deploys `main` the moment it merges; the governed migration workflow
 * runs later, on an owner's approval. In that window PostgREST would fail the
 * WHOLE dossier select on an unknown column — the OPS-GAINDE-04-COMPAT-01
 * incident — so nothing reads or writes `client_po_reference` or
 * `customs_regime_declared` until this says they exist. Both arrive in ONE
 * `alter table`, so asking about one answers for both.
 *
 * A PROBE, NOT A TRY/CATCH, for the reason the precedent gives: wrapping the
 * dossier read would hide a broken policy or a connection fault behind « the
 * column is not there yet ». One narrow question, one SQLSTATE, everything
 * else re-thrown.
 *
 * PER-REQUEST, via React `cache()`: a warm instance that answered `false`
 * before the migration must not keep answering `false` after it.
 *
 * WHAT `false` MEANS: the platform cannot record a PO or an expected regime,
 * so the form does not offer the fields — a field whose value cannot be
 * stored is a lie to the operator.
 *
 * DELETE THIS FILE once #158 is applied and stable. A compatibility shim that
 * outlives its window becomes a place where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgreSQL SQLSTATE for « column does not exist ». */
const UNDEFINED_COLUMN = "42703";

/**
 * True when migration 20261021000002 is applied and the opening fields can be
 * stored and read.
 *
 * Throws on any error that is not « that column is missing ».
 */
export const openingFieldsStored = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("operational_file")
    .select("client_po_reference" as never)
    // ZERO rows: PostgREST validates the projection before fetching anything,
    // so no tenant data crosses and no tenant filter is needed.
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_COLUMN) return false;
  throw new Error(`[files] opening-fields schema probe failed: ${error.message}`);
});
