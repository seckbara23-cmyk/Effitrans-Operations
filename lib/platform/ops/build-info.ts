/**
 * Ops console — build-time expectations (Phase 8.2). PURE constants.
 * ---------------------------------------------------------------------------
 * The serverless bundle cannot read supabase/migrations at runtime and PostgREST does not
 * expose supabase_migrations — so the console displays the EXPECTED latest migration as a
 * build-time constant. Drift is impossible: a unit test pins this constant against the actual
 * migrations directory, so forgetting to bump it fails CI.
 *
 * MIGRATION_PROBE is the newest migration whose effect is verifiable through the exposed API
 * (a data marker, not a DDL change): 20260719000001 inserted the `executive:dashboard:read`
 * permission row. Later DDL-only migrations (e.g. 20260720000001's check constraint) cannot be
 * probed via PostgREST — the console says so honestly instead of over-claiming.
 */

/** The latest migration shipped in this build (pinned to the directory by test). */
export const LATEST_MIGRATION = "20260723000001_workflow_structures";

/** Total migrations shipped in this build (pinned by test). */
export const MIGRATION_COUNT = 54;

/** Newest DATA-probeable migration marker: this permission row proves migrations ≥ this point. */
export const MIGRATION_PROBE = {
  migration: "20260723000001_workflow_structures",
  permissionCode: "process:owner:assign",
} as const;
