-- migrate:executor db-query
-- ===========================================================================
-- Migration 157 — CEO-ALIGNMENT WP1-A: « Business Development Manager ».
-- ===========================================================================
-- DEC-CEO-01 (approved by the owner, 2026-10-21) on CEO-001 — Abdoul's
-- annotation on the SOP Interactif, step 1:
--
--     « Remplacer Quotation manager par Business Development Manager »
--
-- WHAT CHANGES: the two DISPLAY labels of one role row. That is all the CEO
-- asked for — the name people read on /users, on role chips and in the SOP.
--
-- WHAT DELIBERATELY DOES NOT CHANGE, and why it matters:
--   * `role.code` stays `QUOTATION_MANAGER`. Every RLS suite, every journey
--     identity, the process-role mapping (`lib/process/roles.ts`) and every
--     historical `user_role` assignment key on it. Renaming the code would be a
--     data migration across live rows with no visible gain (DEC-CEO-01 option A).
--   * No permission, no `role_permission` row, no assignment, no audit record is
--     touched. The WHERE clause names exactly one tenant and one code.
--   * The French label keeps the English job title on purpose: it is a title,
--     as « Account Manager » already is for the row beside it (seed.sql).
--
-- IDEMPOTENT. Re-running sets the same values. On a database whose role table
-- is still empty (CI applies migrations before the seed), it updates nothing,
-- and the seed — updated in the same change — writes the new labels itself.
-- ===========================================================================

update public.role
   set label_fr   = 'Business Development Manager',
       label_en   = 'Business Development Manager'
 where tenant_id  = '00000000-0000-0000-0000-000000000001'
   and code       = 'QUOTATION_MANAGER'
   and (label_fr is distinct from 'Business Development Manager'
        or label_en is distinct from 'Business Development Manager');
