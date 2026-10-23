-- VERIFIER for 20261023000001_audit_log_truncate_guard
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS: audit_log is append-only against every way of removing
-- rows — UPDATE and DELETE (row triggers, foundation) and now TRUNCATE (a
-- statement trigger) — all through prevent_mutation(), asserted on the
-- trigger→function binding and its timing, not on a trigger name alone.
--
-- WHAT IT DELIBERATELY DOES NOT ASSERT: the absence of the TRUNCATE privilege.
-- The migration revokes it and proves that at apply time, but a later broad
-- GRANT (CI's journey fixture grants service_role DML on every table) would
-- turn a correctly migrated database red here — the CI-REPAIR-02 lesson, and
-- docs/incidents/2026-09-24-parallel-activity-owning-roles.md. The trigger is
-- the guarantee that holds whatever the grants.
-- ===========================================================================
with trg as (
  select t.tgname, t.tgtype, t.tgenabled, p.proname
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = to_regclass('public.audit_log') and not t.tgisinternal
),
checks(label, ok) as (
  values
    ('TRUNCATE on audit_log is refused by prevent_mutation() (BEFORE, statement level, enabled)', (
      select count(*) = 1 from trg
       where tgname = 'trg_audit_log_no_truncate' and proname = 'prevent_mutation'
         and (tgtype & 2) <> 0 and (tgtype & 32) <> 0 and (tgtype & 1) = 0 and tgenabled <> 'D'
    )),
    ('UPDATE on audit_log is still refused by prevent_mutation()', (
      select count(*) >= 1 from trg
       where proname = 'prevent_mutation' and (tgtype & 2) <> 0 and (tgtype & 16) <> 0 and tgenabled <> 'D'
    )),
    ('DELETE on audit_log is still refused by prevent_mutation()', (
      select count(*) >= 1 from trg
       where proname = 'prevent_mutation' and (tgtype & 2) <> 0 and (tgtype & 8) <> 0 and tgenabled <> 'D'
    )),
    ('audit_log keeps row level security enabled', (
      select coalesce(bool_and(relrowsecurity), false) from pg_class where oid = to_regclass('public.audit_log')
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'WP1 closure #162 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — audit_log refuses UPDATE, DELETE and TRUNCATE through prevent_mutation(), RLS still enabled'
    else 'WP1 closure #162 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
