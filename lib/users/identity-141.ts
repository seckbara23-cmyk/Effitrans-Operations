import "server-only";
/**
 * Is migration `20261003000001` applied? — asked, never inferred.
 * ---------------------------------------------------------------------------
 * THE STANDING RULE THIS OBEYS (DEC-C53, ratified 2026-09-07 after the
 * OPS-GAINDE-04-COMPAT-01 incident):
 *
 *     APPLICATION DEPLOYMENT MUST NOT REQUIRE AN UNAPPLIED MIGRATION UNLESS
 *     THE MIGRATION IS GUARANTEED TO RUN FIRST.
 *
 * On 2026-09-07 a deployment asked PostgREST for a column migration #139
 * introduces and production had not applied. PostgREST fails the WHOLE select
 * on an unknown column, so one column took every `/files/[id]` render to the
 * error boundary. This is the third probe of the same shape, and the third is
 * where a pattern earns the right to be called one.
 *
 * WHY A PROBE AND NOT A TRY/CATCH. Wrapping the user read would swallow REAL
 * failures — a broken RLS policy, a connection fault — behind « the column is
 * not there yet », and a Users page that silently renders half its identity is
 * worse than one that fails loudly. This asks ONE narrow question about ONE
 * column, treats exactly one SQLSTATE as the answer, and re-throws everything
 * else.
 *
 * PER-REQUEST, via React `cache()`. A module-level memo would be worse than no
 * memo: a warm serverless instance that answered `false` before the migration
 * would keep answering it afterwards, and an administrator's edit would be
 * refused on a database that could store it.
 *
 * ── WHAT `false` MEANS, WHICH IS THE PART THAT MATTERS ──────────────────────
 * NOT « this user has no name ». It means the platform cannot store a
 * first/last split or a function YET, so:
 *   · the display name is edited as ONE field, on `app_user.name`, which exists;
 *   · the title is edited on `workforce_profile.job_title`, which exists and is
 *     already populated for 30 of 32 profiles;
 *   · Prénom, Nom and Fonction are NOT offered, and the form SAYS SO rather
 *     than pretending the feature was never built.
 *
 * The one thing it must never do is accept those values and drop them. §21:
 * « do not claim data was saved when it could not be persisted. »
 *
 * DELETE THIS FILE once #141 is applied and stable. A compatibility shim that
 * outlives its window becomes a place where a real schema drift can hide.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** PostgreSQL SQLSTATE for « column does not exist ». */
const UNDEFINED_COLUMN = "42703";

/**
 * True when migration 20261003000001 is applied and the canonical first name,
 * last name and function can be stored.
 *
 * Probed on `first_name` specifically: all three columns arrive in the SAME
 * migration, so one answers for the whole slice.
 *
 * Throws on any error that is not « that column is missing » — a probe that
 * reported `false` for a connection fault would silently downgrade the Users
 * page during an outage and tell an administrator the platform cannot store a
 * name it can store perfectly well.
 */
export const staffIdentityStored = cache(async (): Promise<boolean> => {
  const admin = getAdminSupabaseClient();
  const { error } = await admin
    .from("workforce_profile")
    .select("first_name")
    // ZERO rows. PostgREST validates the projection against the schema before
    // it fetches anything, so the question is answered without a single row —
    // and therefore without an unscoped read crossing a tenant boundary.
    .limit(0);
  if (!error) return true;
  if (error.code === UNDEFINED_COLUMN) return false;
  throw new Error(`[users] identity schema probe failed: ${error.message}`);
});
