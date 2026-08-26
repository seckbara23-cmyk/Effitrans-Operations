-- ===========================================================================
-- Migration 126 — C-4: Recouvrement can accept the handoff routed to it.
-- ===========================================================================
-- `process_step_receiving_role` registers COLLECTIONS_OFFICER and
-- FINANCE_OFFICER as the receivers of the Administration → Recouvrement
-- handoff, and the `collections` queue names the same two roles. Neither held
-- `process:handoff:receive`, so the only actor who could accept work routed to
-- Recouvrement was a supervisor — hidden intervention at the last departmental
-- transfer in the chain.
--
-- WHY THIS GRANT IS NARROW, AND WHY IT COULD NOT BE MADE BEFORE.
--
-- Until now `receiveHandoff` checked the permission, the tenant, dossier
-- visibility and that the handoff was SENT — and never whether the caller was
-- the department the work was routed TO. Any holder of the permission could
-- accept any open handoff on any dossier they could see. Granting two more
-- roles would have widened that.
--
-- The engine now requires BOTH: `process:handoff:receive` AND routed-receiver
-- eligibility for the target step, resolved from the process registry (a step's
-- department, and the roles that staff that department's queue). So this grant
-- lets these two roles accept work routed to Recouvrement and nothing else —
-- the permission alone no longer decides anything.
--
-- Eligibility is deliberately NOT read from `process_step_receiving_role`. That
-- table declares itself "Registry projection … Never a source of mutation
-- authority", and it is seeded only for the four targets the platform sends to
-- today; enforcing against it would leave every other handoff target
-- unreceivable by anyone. The registry answers for every step and is the source
-- the projection is copied from.
--
-- Mirrored in seed.sql and role-templates.ts. Tenant-wide by role code: every
-- tenant's Recouvrement receives this handoff.

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:handoff:receive'
where r.code in ('COLLECTIONS_OFFICER', 'FINANCE_OFFICER')
on conflict do nothing;

do $$
declare
  v_roles     int;
  v_granted   int;
  v_registered int;
  v_leaked    int;
begin
  select count(*) into v_roles
  from public.role where code in ('COLLECTIONS_OFFICER', 'FINANCE_OFFICER');

  select count(*) into v_granted
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code in ('COLLECTIONS_OFFICER', 'FINANCE_OFFICER')
    and p.code = 'process:handoff:receive';

  if v_granted <> v_roles then
    raise exception 'M126: expected % grants of process:handoff:receive, got %', v_roles, v_granted;
  end if;

  -- The premise: these two roles really are the registered receivers for
  -- Recouvrement. If routing changes, this grant needs revisiting rather than
  -- silently outliving its reason.
  select count(*) into v_registered
  from public.process_step_receiving_role
  where step_key = 'collections'
    and role_code in ('COLLECTIONS_OFFICER', 'FINANCE_OFFICER');

  if v_registered <> 2 then
    raise exception 'M126: collections is no longer routed to both roles (% rows) — revisit this grant', v_registered;
  end if;

  -- Receiving is not executing. Neither role may gain the authority to SEND a
  -- handoff onward merely because it can accept one.
  select count(*) into v_leaked
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'COLLECTIONS_OFFICER'
    and p.code = 'process:handoff:send';

  if v_leaked <> 0 then
    raise exception 'M126: COLLECTIONS_OFFICER gained process:handoff:send, which this migration must not grant';
  end if;

  raise notice 'M126 OK: process:handoff:receive granted to % role(s); routing unchanged; no send authority added', v_granted;
end $$;
