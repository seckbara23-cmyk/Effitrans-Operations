import "server-only";
/**
 * Is migration `20261001000001` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * THE INCIDENT THIS EXISTS FOR. `92aa2c3` shipped the application half of
 * OPS-CUSTOMS-GAINDE-04 while production deliberately stayed at schema 138, and
 * `RECORD_COLS` asked PostgREST for `gainde_declaration_reference` — a column
 * that migration introduces. Every `/files/[id]` render threw
 * « [customs] read failed: column customs_record.gainde_declaration_reference
 * does not exist » and the dossier route reached the error boundary. Writing
 * code for a schema that is not deployed is a deployment mistake, not a schema
 * one, and this is where that mistake is now caught.
 *
 * WHY A PROBE AND NOT A TRY/CATCH AROUND THE READ. Wrapping the record query
 * would swallow REAL failures — a broken RLS policy, a dropped index, a
 * connection fault — behind « the column is not there yet », and a dossier that
 * silently renders half its customs data is worse than one that fails loudly.
 * So this asks ONE narrow question about ONE column, and every other error is
 * re-thrown unchanged.
 *
 * WHY IT LOOKS LIKE AN ERROR CHECK ANYWAY. PostgREST exposes only the `public`
 * schema, so `information_schema.columns` is unreachable through this client.
 * The available question is a zero-row select, and the answer is the SQLSTATE:
 * `42703` (undefined column) is the migration not being applied, and nothing
 * else. That is a specific code for a specific column, not a catch-all.
 *
 * PER-REQUEST, via React `cache()`. A module-level memo would be worse than no
 * memo: a warm serverless instance that answered `false` before the migration
 * would keep answering `false` afterwards, and the reference would read as
 * absent on a database that has it. One probe per request self-heals the moment
 * #139 lands, with no deploy and no restart.
 *
 * DELETE THIS FILE once #139 is applied and stable. It is scaffolding for one
 * window, and a compatibility shim that outlives its window becomes a place
 * where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgreSQL SQLSTATE for « column does not exist ». */
const UNDEFINED_COLUMN = "42703";

/**
 * True when migration 20261001000001 is applied.
 *
 * Probed on `customs_record.gainde_declaration_reference` specifically: it and
 * the tax-payment tables arrive in the SAME migration, so one column answers
 * for the whole slice, and a column probe is cheaper than a table probe.
 *
 * Throws on any error that is not « that column is missing » — a probe that
 * reported `false` for a connection fault would turn an outage into silent data
 * loss on the page.
 */
export const gaindeLedgerAvailable = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("customs_record")
    .select("gainde_declaration_reference")
    // ZERO rows. PostgREST validates the projection against the schema before
    // it fetches anything, so the question is answered without a single row —
    // and therefore without an unscoped read crossing a tenant boundary.
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_COLUMN) return false;
  throw new Error(`[customs] schema probe failed: ${error.message}`);
});
