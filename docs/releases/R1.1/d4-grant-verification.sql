-- =========================================================================
-- R1.1 · D4 — Finance Aging grant verification (READ-ONLY)
-- =========================================================================
-- Paste into the Supabase SQL Editor as-is. One result set; every row carries
-- a boolean `passed`. D4 passes ONLY when every row is true.
--
-- READ-ONLY BY CONSTRUCTION: SELECTs over public.permission / role /
-- role_permission and literal VALUES. No writes, no DDL, no temp objects.
--
-- THE RATIFIED MATRIX (authoritative source: migration
-- 20260729000002_aging_balance_foundation.sql, grant block lines 748–795 —
-- the exact INSERTs that created production's grants, under the ratified
-- D-11 doctrine):
--
--   read            FINANCE_OFFICER ACCOUNTANT TREASURER DAF DGA CEO SYSTEM_ADMIN
--   draft_create    FINANCE_OFFICER ACCOUNTANT DAF SYSTEM_ADMIN
--   draft_update    FINANCE_OFFICER ACCOUNTANT DAF SYSTEM_ADMIN
--   import_stage    ACCOUNTANT DAF SYSTEM_ADMIN
--   import_approve  DAF DGA
--   validate        DAF DGA
--   finalize        DAF DGA
--   export          FINANCE_OFFICER ACCOUNTANT TREASURER DAF DGA CEO SYSTEM_ADMIN
--   print           FINANCE_OFFICER ACCOUNTANT TREASURER DAF DGA CEO SYSTEM_ADMIN
--   share           DAF DGA
--   template_manage DAF
--
-- APPROVAL CLASS (SYSTEM_ADMIN must hold NONE — D-11: "administering a system
-- is not financial signoff authority"): validate · finalize · import_approve ·
-- share · template_manage.
--
-- Grants are tenant-UNFILTERED by design (the migration backfilled every
-- tenant), so the comparison is on DISTINCT role codes per permission across
-- all tenants: a deviation in ANY tenant fails the row.
-- =========================================================================

with expected(code, role_code) as (
  values
    ('finance:aging:read',            'FINANCE_OFFICER'),
    ('finance:aging:read',            'ACCOUNTANT'),
    ('finance:aging:read',            'TREASURER'),
    ('finance:aging:read',            'DAF'),
    ('finance:aging:read',            'DGA'),
    ('finance:aging:read',            'CEO'),
    ('finance:aging:read',            'SYSTEM_ADMIN'),
    ('finance:aging:draft_create',    'FINANCE_OFFICER'),
    ('finance:aging:draft_create',    'ACCOUNTANT'),
    ('finance:aging:draft_create',    'DAF'),
    ('finance:aging:draft_create',    'SYSTEM_ADMIN'),
    ('finance:aging:draft_update',    'FINANCE_OFFICER'),
    ('finance:aging:draft_update',    'ACCOUNTANT'),
    ('finance:aging:draft_update',    'DAF'),
    ('finance:aging:draft_update',    'SYSTEM_ADMIN'),
    ('finance:aging:import_stage',    'ACCOUNTANT'),
    ('finance:aging:import_stage',    'DAF'),
    ('finance:aging:import_stage',    'SYSTEM_ADMIN'),
    ('finance:aging:import_approve',  'DAF'),
    ('finance:aging:import_approve',  'DGA'),
    ('finance:aging:validate',        'DAF'),
    ('finance:aging:validate',        'DGA'),
    ('finance:aging:finalize',        'DAF'),
    ('finance:aging:finalize',        'DGA'),
    ('finance:aging:export',          'FINANCE_OFFICER'),
    ('finance:aging:export',          'ACCOUNTANT'),
    ('finance:aging:export',          'TREASURER'),
    ('finance:aging:export',          'DAF'),
    ('finance:aging:export',          'DGA'),
    ('finance:aging:export',          'CEO'),
    ('finance:aging:export',          'SYSTEM_ADMIN'),
    ('finance:aging:print',           'FINANCE_OFFICER'),
    ('finance:aging:print',           'ACCOUNTANT'),
    ('finance:aging:print',           'TREASURER'),
    ('finance:aging:print',           'DAF'),
    ('finance:aging:print',           'DGA'),
    ('finance:aging:print',           'CEO'),
    ('finance:aging:print',           'SYSTEM_ADMIN'),
    ('finance:aging:share',           'DAF'),
    ('finance:aging:share',           'DGA'),
    ('finance:aging:template_manage', 'DAF')
),
actual as (
  select distinct p.code, r.code as role_code
    from public.role_permission rp
    join public.role r       on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code like 'finance:aging:%'
),
approval_class(code) as (
  values ('finance:aging:validate'), ('finance:aging:finalize'),
         ('finance:aging:import_approve'), ('finance:aging:share'),
         ('finance:aging:template_manage')
)

select * from (

-- ------------------------------------------------------------ 0 · controls
select '0-control' as section, 'nonexistent permission is absent (probe works)' as check_name,
       not exists (select 1 from public.permission where code = 'finance:aging:never_granted') as passed,
       'expect true' as detail

-- ------------------------------------------------------------ 1 · catalog
union all
select '1-catalog', 'exactly 11 finance:aging:* permission rows',
       (select count(*) from public.permission where code like 'finance:aging:%') = 11,
       (select string_agg(code, ' · ' order by code) from public.permission where code like 'finance:aging:%')

-- ------------------------------------ 2 · THE D4 CRITERION: SYSTEM_ADMIN vs approval class
union all
select '2-sysadmin', 'SYSTEM_ADMIN holds NO approval-class permission (any tenant)',
       not exists (select 1 from actual a join approval_class ac on ac.code = a.code
                    where a.role_code = 'SYSTEM_ADMIN'),
       coalesce((select string_agg(a.code, ' · ') from actual a
                   join approval_class ac on ac.code = a.code
                  where a.role_code = 'SYSTEM_ADMIN'), 'none held (correct)')
union all
select '2-sysadmin', 'SYSTEM_ADMIN holds EXACTLY the six intended codes',
       (select string_agg(code, ' · ' order by code) from actual where role_code = 'SYSTEM_ADMIN')
       = 'finance:aging:draft_create · finance:aging:draft_update · finance:aging:export · finance:aging:import_stage · finance:aging:print · finance:aging:read',
       coalesce((select string_agg(code, ' · ' order by code) from actual where role_code = 'SYSTEM_ADMIN'),
                'SYSTEM_ADMIN holds NOTHING — investigate before proceeding')

-- ------------------------------------------------ 3 · full matrix, per permission
union all
select '3-matrix ' || e.code,
       'role set matches the ratified matrix exactly',
       coalesce((select string_agg(role_code, ' · ' order by role_code) from actual   where code = e.code), '(nobody)')
     = (select string_agg(role_code, ' · ' order by role_code) from expected where code = e.code),
       'actual: ' || coalesce((select string_agg(role_code, ' · ' order by role_code) from actual where code = e.code), '(nobody)')
from (select distinct code from expected) e

-- ------------------------------------------------ 4 · deviation catch-alls
union all
select '4-deviations', 'no EXTRA grant beyond the ratified matrix (any role, any tenant)',
       not exists (select 1 from actual a
                    where not exists (select 1 from expected e
                                       where e.code = a.code and e.role_code = a.role_code)),
       coalesce((select string_agg(a.role_code || ' → ' || a.code, ' · ')
                   from actual a
                  where not exists (select 1 from expected e
                                     where e.code = a.code and e.role_code = a.role_code)),
                'no extra grants (correct)')
union all
select '4-deviations', 'no MISSING grant from the ratified matrix',
       not exists (select 1 from expected e
                    where not exists (select 1 from actual a
                                       where a.code = e.code and a.role_code = e.role_code)),
       coalesce((select string_agg(e.role_code || ' → ' || e.code, ' · ')
                   from expected e
                  where not exists (select 1 from actual a
                                     where a.code = e.code and a.role_code = e.role_code)),
                'no missing grants (correct)')

) checks
order by section, check_name;

-- =========================================================================
-- Evidence listing (informational — no pass/fail): every role holding each
-- finance:aging:* permission, with the tenant count behind each role code.
-- =========================================================================
select p.code as permission,
       r.code as role_code,
       count(distinct r.tenant_id) as tenants_with_grant
  from public.role_permission rp
  join public.role r       on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
 where p.code like 'finance:aging:%'
 group by p.code, r.code
 order by p.code, r.code;
