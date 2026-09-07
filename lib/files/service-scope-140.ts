import "server-only";
/**
 * Is migration `20261002000001` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * THE PRECEDENT THIS FOLLOWS, and the incident behind it. On 2026-09-07 a
 * deployment shipped application code that asked PostgREST for
 * `customs_record.gainde_declaration_reference`, a column migration
 * 20261001000001 introduces and production had not applied. PostgREST fails the
 * WHOLE select on an unknown column, so one unapplied column took every
 * `/files/[id]` render to the error boundary. Writing code for a schema that is
 * not deployed is a deployment mistake, and OPS-UAT-CONVERGENCE-01 §19 raised
 * the lesson to a standing rule:
 *
 *     APPLICATION DEPLOYMENT MUST NOT REQUIRE AN UNAPPLIED MIGRATION UNLESS
 *     THE MIGRATION IS GUARANTEED TO RUN FIRST.
 *
 * Migration 20261002000001 is written and deliberately NOT applied, so this
 * slice ships the same way: nothing asks for `operational_file.services` until
 * this says the column is there.
 *
 * WHY A PROBE AND NOT A TRY/CATCH. Wrapping the dossier read would swallow REAL
 * failures — a broken RLS policy, a connection fault — behind « the column is
 * not there yet », and a dossier that silently renders half its facts is worse
 * than one that fails loudly. This asks ONE narrow question about ONE column,
 * treats exactly one SQLSTATE as the answer, and re-throws everything else.
 *
 * PER-REQUEST, via React `cache()`. A module-level memo would be worse than no
 * memo: a warm serverless instance that answered `false` before the migration
 * would keep answering `false` afterwards, and an operator's explicit service
 * choice would be silently dropped on a database that can store it. One probe
 * per request self-heals the moment #140 lands, with no deploy and no restart.
 *
 * AND WHAT `false` MEANS HERE, WHICH IS THE IMPORTANT PART. Not « no services »
 * — that would put every dossier out of scope for everything. It means « the
 * platform cannot record a choice », so `scopeFromRow` derives what the dossier
 * TYPE genuinely establishes and leaves the rest UNKNOWN, and UNKNOWN removes
 * no step from any dossier.
 *
 * DELETE THIS FILE once #140 is applied and stable. A compatibility shim that
 * outlives its window becomes a place where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgreSQL SQLSTATE for « column does not exist ». */
const UNDEFINED_COLUMN = "42703";

/**
 * True when migration 20261002000001 is applied and a service scope can be
 * stored and read.
 *
 * Throws on any error that is not « that column is missing »: a probe that
 * reported `false` for a connection fault would turn an outage into a silently
 * discarded operator choice.
 */
export const serviceScopeStored = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("operational_file")
    .select("services")
    // ZERO rows. PostgREST validates the projection against the schema before
    // it fetches anything, so the question is answered without a single row —
    // and therefore without an unscoped read crossing a tenant boundary.
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_COLUMN) return false;
  throw new Error(`[files] service-scope schema probe failed: ${error.message}`);
});
