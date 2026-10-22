-- VERIFIER for 20261021000001_role_label_business_development_manager
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS. A label change is trivially « applied » — the interesting
-- failures are the quiet ones around it:
--   * the code was renamed instead of the label (DEC-CEO-01 forbids it), which
--     would orphan every assignment and RLS identity keyed on QUOTATION_MANAGER;
--   * some row still carries the old wording, so the platform names one role
--     two ways;
--   * the old wording survives on ANOTHER role row (a copy-paste rename).
--
-- VACUOUS-PASS GUARD. On a fresh database migrations run before the seed, so
-- the role table may hold no QUOTATION_MANAGER row at all. The label checks
-- below are « no row disagrees », which is true there; the code check is
-- « a row exists » only where the tenant row exists, so it cannot fail a
-- database the seed has not reached yet, and cannot pass a renamed one.
-- ===========================================================================
-- SCOPE. The migration names ONE tenant, so every check below is about that
-- tenant: other tenants (CI creates some) are provisioned from the role
-- templates, which carry the same label, but this verifier does not claim
-- anything the migration did not do.
with r as (
  select tenant_id, code, label_fr, label_en
    from public.role
   where tenant_id = '00000000-0000-0000-0000-000000000001'
),
tenant_present as (
  select exists (
    select 1 from public.role where tenant_id = '00000000-0000-0000-0000-000000000001'
  ) as yes
),
checks(label, ok) as (
  values
    ('every QUOTATION_MANAGER row reads « Business Development Manager » in both languages', (
      select count(*) = 0 from r
       where r.code = 'QUOTATION_MANAGER'
         and (r.label_fr is distinct from 'Business Development Manager'
              or r.label_en is distinct from 'Business Development Manager')
    )),
    ('the technical code QUOTATION_MANAGER is kept wherever the Effitrans tenant has roles', (
      select (not tp.yes) or exists (
        select 1 from r
         where r.tenant_id = '00000000-0000-0000-0000-000000000001'
           and r.code = 'QUOTATION_MANAGER')
        from tenant_present tp
    )),
    ('no role was renamed to a new code', (
      select count(*) = 0 from r
       where r.code ilike '%BUSINESS%DEVELOPMENT%' or r.code ilike 'BDM%'
    )),
    ('the old wording survives on no role row', (
      select count(*) = 0 from r
       where r.label_fr = 'Responsable des cotations' or r.label_en = 'Quotation Manager'
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CEO-ALIGNMENT WP1-A #157 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — the role reads « Business Development Manager », its code is still QUOTATION_MANAGER, and no other row was renamed'
    else 'CEO-ALIGNMENT WP1-A #157 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
