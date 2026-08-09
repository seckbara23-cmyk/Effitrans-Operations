-- OPS-SEC-2A — catalog-derived security invariants. READ-ONLY.
--
-- Derived from pg_catalog, so a NEW function is subject to every rule the day
-- it lands. That is deliberate: the tenant-table registry is the cautionary
-- tale in this codebase -- hand-maintained, and silent about 63 of 140 tables
-- for months. A check whose omissions pass unnoticed is worse than no check,
-- because it reads as coverage.
--
-- Only two invariants need an explicit list, and both are written so that
-- ANYTHING NOT LISTED FAILS, never the reverse.

begin;

create temp table _inv (id text, ok boolean, detail text) on commit drop;

-- ---------------------------------------------------------------------------
-- INV-1 — no browser-executable privileged function.
-- Every non-trigger SECURITY DEFINER function must be service_role-only. The
-- allowlist is the RLS policy helpers, which MUST stay reachable by
-- `authenticated` or every policy calling them breaks -- the OPS-SEC-1 outage.
-- ---------------------------------------------------------------------------
with allow(fn) as (values
  ('auth_tenant_id'),('has_permission'),('can_read_file'),('portal_can_read_file'),
  ('portal_can_read_shipment'),('user_can_read_mailbox'),('auth_portal_client_id'),
  ('messaging_staff_can_access_conversation'),('auth_portal_tenant_id'),
  ('portal_can_read_invoice'),('messaging_portal_can_access_conversation'),
  ('is_assigned_driver'),('can_read_task'),('user_readable_file_ids'),
  ('get_user_permissions')
),
bad as (
  select regexp_replace(p.oid::regprocedure::text,'^[^(]*','public.'||p.proname) as sig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  where p.prokind='f' and p.prosecdef
    and pg_get_function_result(p.oid) <> 'trigger'
    and p.proname not in (select fn from allow)
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
)
insert into _inv
select 'INV-1 no browser-executable privileged function',
       count(*) = 0,
       coalesce(string_agg(sig, ', '), 'none')
from bad;

-- ---------------------------------------------------------------------------
-- INV-2 — every SECURITY DEFINER function pins its search_path.
-- ---------------------------------------------------------------------------
insert into _inv
select 'INV-2 search_path pinned on every SECURITY DEFINER',
       count(*) = 0,
       coalesce(string_agg(p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where p.prokind='f' and p.prosecdef
  and coalesce(array_to_string(p.proconfig,' '),'') !~ 'search_path';

-- ---------------------------------------------------------------------------
-- INV-3 — no dynamic SQL inside a SECURITY DEFINER function.
-- (Privilege migrations use EXECUTE inside DO blocks, which are not functions
-- and are not reachable after the migration runs.)
-- ---------------------------------------------------------------------------
insert into _inv
select 'INV-3 no dynamic SQL in SECURITY DEFINER functions',
       count(*) = 0,
       coalesce(string_agg(p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where p.prokind='f' and p.prosecdef and p.prosrc ~* '\mexecute\M';

-- ---------------------------------------------------------------------------
-- INV-4 — no transitive trust break.
-- THE OPS-SEC-1 OUTAGE, generalised. A SECURITY INVOKER function executes its
-- inner calls AS THE ORIGINAL CALLER, so every function it calls must also be
-- callable by that role. can_read_file -> user_readable_file_ids broke exactly
-- this way and took 21 policies down with it.
-- Checked for both browser roles.
-- ---------------------------------------------------------------------------
--
-- ONE KNOWN EXCEPTION, named rather than excused:
--   can_read_file -[anon]-> user_readable_file_ids
-- OPS-SEC-2 §4 recorded this as the latent mirror of the outage. It is not
-- reachable — 0 of 172 policies target `anon`, so no policy ever evaluates as
-- that role — and the fix (revoking `anon` from can_read_file) is P2 and
-- explicitly outside OPS-SEC-2A's scope. It is listed so that it cannot grow
-- quietly: any OTHER pair, in either role, fails this invariant.
insert into _inv
select 'INV-4 no SECURITY INVOKER function calls something its caller cannot execute',
       count(*) = 0,
       coalesce(string_agg(detail, ', '), 'none')
from (
  select c.proname || ' -[' || role_name || ']-> ' || d.proname as detail
  from (values ('anon'),('authenticated')) as r(role_name)
  cross join lateral (
    select p.oid, p.proname, p.prosrc
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.prokind='f' and not p.prosecdef
      and has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) c
  join lateral (
    select p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.prokind='f'
      and not has_function_privilege(r.role_name, p.oid, 'EXECUTE')
      and c.prosrc ~ ('\m' || p.proname || '\s*\(')
  ) d on true
  -- the single ratified exception, matched exactly
  where not (r.role_name = 'anon'
             and c.proname = 'can_read_file'
             and d.proname = 'user_readable_file_ids')
) q;

-- ---------------------------------------------------------------------------
-- INV-5 — the RLS dependency closure stays executable by `authenticated`.
-- Policy -> helper -> whatever that helper calls. Computing only the first hop
-- is what made the outage invisible to review.
-- ---------------------------------------------------------------------------
with recursive direct as (
  select distinct p.oid, p.proname, p.prosrc
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  join pg_policy pol on
    (coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||' '||
     coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
    ~ ('\m'||p.proname||'\s*\(')
  where p.prokind='f'
),
closure as (
  select oid, proname, prosrc from direct
  union
  select p.oid, p.proname, p.prosrc
  from closure c
  join pg_proc p on p.prokind='f'
  join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  where c.prosrc ~ ('\m' || p.proname || '\s*\(') and p.oid <> c.oid
)
insert into _inv
select 'INV-5 entire RLS dependency closure executable by authenticated',
       count(*) = 0,
       coalesce(string_agg(proname, ', '), 'none')
from closure
where not has_function_privilege('authenticated', oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- INV-6 — the pilot functions actually use the canonical primitive.
-- Explicit by necessity, and written so an unlisted pilot cannot slip through:
-- each named signature must exist AND must call assert_actor_authority.
-- ---------------------------------------------------------------------------
with pilot(sig) as (values
  ('public.next_file_number(uuid,text,uuid)'),
  ('public.next_employee_number(uuid,uuid)')
)
insert into _inv
select 'INV-6 pilot RPCs call assert_actor_authority',
       count(*) = 0,
       coalesce(string_agg(sig, ', '), 'none')
from pilot
where to_regprocedure(sig) is null
   or (select p.prosrc from pg_proc p where p.oid = to_regprocedure(pilot.sig))
      !~ 'assert_actor_authority';

-- ---------------------------------------------------------------------------
-- INV-7 — caller-declared identity without a trust contract.
-- The OPS-SEC-2B worklist, pinned. Any function taking an actor/tenant that
-- does NOT call the primitive counts here. The number may only go DOWN, and a
-- new one pushes it up and fails CI naming itself.
--
-- 50 was the audited figure; the two pilot overloads are verified, so 50
-- remains the unverified count until 2B converts more.
-- ---------------------------------------------------------------------------
with unverified as (
  select regexp_replace(p.oid::regprocedure::text,'^[^(]*','public.'||p.proname) as sig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  where p.prokind='f'
    and pg_get_function_result(p.oid) <> 'trigger'
    and pg_get_function_identity_arguments(p.oid) ~* '(p_actor|p_tenant|p_user|organization)'
    and p.prosrc !~ 'assert_actor_authority'
)
insert into _inv
select 'INV-7 unverified caller-declared identity count has not grown',
       count(*) <= 50,
       count(*)::text || ' (ceiling 50): ' ||
       coalesce(substring(string_agg(sig, ', ') for 400), 'none')
from unverified;

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
select id, ok, detail from _inv order by id;

do $verdict$
declare v_bad text;
begin
  select string_agg(id || ' -> ' || detail, ' | ') into v_bad from _inv where not ok;
  if v_bad is not null then
    raise exception 'OPS-SEC-2A catalog invariants FAILED: %', v_bad;
  end if;
  raise notice 'OPS-SEC-2A catalog invariants: all passed';
end
$verdict$;

rollback;
