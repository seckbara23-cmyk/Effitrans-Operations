-- VERIFIER for 20261006000001_parallel_activity_owning_roles
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT CHECKS, AND WHY IT CHECKS MEANING. « The three rows exist » is not
-- enough. The defect was never a missing row in the abstract: it was that the
-- gate `activateStep` consults had NOTHING to say about these three activities,
-- so it deferred to `document:create` — a permission fourteen roles hold — and a
-- Coordinator claimed an Account Manager activity on EFT-IMP-2026-00011. So the
-- assertions below are about the WHOLE chain that makes the gate bite: the rows
-- exist, they name ACCOUNT_MANAGER, no step carries a second owner that would
-- widen it, the owner can actually EXECUTE what it now owns (the step-16 trap),
-- the reader that enforces it still reads this table, and nobody but a migration
-- can write to it.
--
-- WHAT IT DELIBERATELY DOES NOT CHECK. Whether any particular execution row
-- changed. A verifier reasons from the schema, and the claim « no execution was
-- rewritten » is provable structurally instead, and more strongly: this table
-- carries no trigger and nothing references it, so writing a row here CANNOT
-- reach an execution. That is check 6.
-- ===========================================================================
with activities(step_key) as (
  values ('bon_a_delivrer'), ('pre_gate'), ('transport_docs_transmission')
),
src as (
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as readable_fn
    from pg_proc p
   where p.oid = to_regprocedure('public.user_readable_file_ids(uuid,uuid)')
),
checks(label, ok) as (
  select * from (values

    -- ---- 1. The three activities are owned, each by exactly one role -------
    ('each parallel activity carries exactly one owning-role row', (
      select count(*) = 3 from (
        select a.step_key
          from activities a
          join public.process_step_owning_role sor on sor.step_key = a.step_key
         group by a.step_key
        having count(*) = 1
      ) s
    )),
    ('and that owner is ACCOUNT_MANAGER for all three', (
      select count(*) = 3
        from activities a
        join public.process_step_owning_role sor
          on sor.step_key = a.step_key and sor.role_code = 'ACCOUNT_MANAGER'
    )),

    -- ---- 2. Additive: the 26 numbered steps are untouched ------------------
    ('the map holds 29 rows: 26 numbered steps plus 3 parallel activities', (
      select count(*) = 29 from public.process_step_owning_role
    )),
    ('no step key carries a second owner that would widen the gate', (
      select count(distinct step_key) = 29 from public.process_step_owning_role
    )),
    ('the 26 numbered steps are all still mapped', (
      select count(*) = 26 from public.process_step_owning_role where note like 'step %'
    )),
    ('step 1, step 6, step 16 and step 26 keep the owners they had', (
      select bool_and(found) from (
        select exists (
          select 1 from public.process_step_owning_role
           where step_key = e.k and role_code = e.r
        ) as found
          from (values
            ('cotation', 'QUOTATION_MANAGER'),
            ('customs_preparation', 'CUSTOMS_DECLARANT'),
            ('am_delivery_followup', 'ACCOUNT_MANAGER'),
            ('collections', 'COLLECTIONS_OFFICER')
          ) as e(k, r)
      ) s
    )),

    -- ---- 3. ⚠ THE STEP-16 TRAP --------------------------------------------
    -- Migration 20260917000001 exists because step 16 was owned by a role that
    -- could not execute it: the owner was shown work and then refused it. The
    -- three activities declare `document:create` and `process:handoff:send`
    -- between them; the role that now owns them must hold both, in EVERY tenant
    -- that has the role.
    ('ACCOUNT_MANAGER can execute every activity it now owns, in every tenant', (
      select not exists (
        select 1
          from public.role r
         cross join (values ('document:create'), ('process:handoff:send')) as p(code)
         where r.code = 'ACCOUNT_MANAGER'
           and not exists (
             select 1
               from public.role_permission rp
               join public.permission pm on pm.id = rp.permission_id
              where rp.role_id = r.id and pm.code = p.code
           )
      )
    )),

    -- ---- 4. NOT WEAKENED: ownership widened, authority did not -------------
    ('TMS-4 holds: ACCOUNT_MANAGER still holds no Transport execution grant', (
      select not exists (
        select 1
          from public.role r
          join public.role_permission rp on rp.role_id = r.id
          join public.permission pm on pm.id = rp.permission_id
         where r.code = 'ACCOUNT_MANAGER'
           and pm.code in ('transport:complete', 'transport:assign', 'transport:create',
                           'transport:manage', 'transport:delete')
      )
    )),

    -- ---- 5. The rule that reads this table is still armed, and still narrow
    ('user_readable_file_ids still joins the owning-role map', (
      select readable_fn ~ 'process_step_owning_role' from src
    )),
    ('and still narrows the moment a step is claimed', (
      select readable_fn ~ 'assigned_user_id is null' from src
    )),

    -- ---- 6. Writing a row here CANNOT reach an execution row ---------------
    ('the owning-role map carries no trigger', (
      select not exists (
        select 1 from pg_trigger t
         where t.tgrelid = to_regclass('public.process_step_owning_role')
           and not t.tgisinternal
      )
    )),
    ('and no constraint anywhere depends on it', (
      select not exists (
        select 1 from pg_constraint c
         where c.confrelid = to_regclass('public.process_step_owning_role')
      )
    )),

    -- ---- 7. Only a migration may write an owner ----------------------------
    -- The gate is only as strong as this table. A client that could write it
    -- could grant itself ownership of any step.
    ('the map is readable but not writable by authenticated or anon', (
      select not has_table_privilege('authenticated', 'public.process_step_owning_role', 'INSERT')
         and not has_table_privilege('authenticated', 'public.process_step_owning_role', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.process_step_owning_role', 'DELETE')
         and not has_table_privilege('anon', 'public.process_step_owning_role', 'INSERT')
         and not has_table_privilege('anon', 'public.process_step_owning_role', 'UPDATE')
         and not has_table_privilege('anon', 'public.process_step_owning_role', 'DELETE')
    )),
    ('and row level security is still enabled on it', (
      select c.relrowsecurity from pg_class c
       where c.oid = to_regclass('public.process_step_owning_role')
    ))
  ) as t(label, ok)
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'UAT-PARALLEL-OWNERSHIP-01 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'UAT-PARALLEL-OWNERSHIP-01 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
