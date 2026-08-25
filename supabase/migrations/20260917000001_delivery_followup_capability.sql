-- ===========================================================================
-- Migration 125 — C-4: a capability for what step 16 actually IS.
-- ===========================================================================
-- Official step 16, `am_delivery_followup` — « suivre la livraison jusqu'à
-- réception client » — is ACCOUNT_MANAGER's, in the registry and in
-- `process_step_owning_role`, which is what decides whose queue it appears in.
-- Its execution permission was `transport:complete`, which ACCOUNT_MANAGER does
-- not hold, so the owner was shown work it was then refused and the step was
-- performable only by a supervisor. Every step from 17 to closure sits behind
-- it, so the canonical chain depended on that intervention.
--
-- The first correction attempted was to grant `transport:complete` to
-- ACCOUNT_MANAGER. It was WITHDRAWN: TMS-4 ratified the split deliberately —
-- the Account Manager REQUESTS transport, Transport EXECUTES it — and names
-- `transport:complete` in the set that role must never hold. That boundary
-- stands, unmodified.
--
-- The real fault was narrower and more interesting: step 16's gate encoded an
-- act belonging to a DIFFERENT department than the step does. Two things happen
-- at delivery, and the registry conflated them —
--   * the Account Manager's act: follow the delivery to client reception and
--     obtain the signed Bordereau de Livraison (the step's requiredDocuments);
--   * Transport's act: move the transport record to DELIVERED / POD_RECEIVED.
-- Step 16 is the first and was gated on the permission for the second. Nothing
-- in the engine needs `transport:complete` to COMPLETE step 16: `submitStep`
-- checks the step's permission and its evidence, and the evidence is the signed
-- delivery note. The permission was doing no work there except blocking its own
-- owner.
--
-- So this introduces a capability that means what the step means, and nothing
-- more. It authorizes performing the Account Manager's official delivery
-- follow-up — satisfying step 16's evidence and completing that workflow step.
-- It does NOT authorize changing transport operational status, marking a
-- transport DELIVERED or POD_RECEIVED, assigning vehicles/drivers/carriers,
-- executing a pickup, or any other Transport-owned mutation. Those remain
-- exactly where TMS-4 and TMS-5 put them.
--
-- GRANTS are deliberately not "every holder of transport:complete". They are
-- the roles that legitimately perform step 16:
--   ACCOUNT_MANAGER — the authoritative owner of the step;
--   OPS_SUPERVISOR  — supervises the account-management queue and could perform
--                     step 16 before this change; removing that would be a
--                     regression dressed as a fix;
--   SYSTEM_ADMIN    — administrative continuity, as elsewhere.
-- TRANSPORT_OFFICER is deliberately ABSENT: it holds transport:complete, but
-- holding the old gate is not evidence of owning the step, and copying the
-- holders across is exactly the reasoning that produced the defect.

insert into public.permission (code, module, action, data_scope, description) values
  ('process:delivery:followup', 'process', 'followup', 'assigned',
   'Perform the Account Manager official delivery follow-up (step 16): obtain the signed delivery note and complete that workflow step. Confers NO transport execution authority.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:delivery:followup'
where r.code in ('ACCOUNT_MANAGER', 'OPS_SUPERVISOR', 'SYSTEM_ADMIN')
on conflict do nothing;

-- Self-assertions. The TMS ones are the point: this migration exists BECAUSE a
-- boundary was nearly crossed, so it proves the boundary is still there.
do $$
declare
  v_perm    int;
  v_roles   int;
  v_granted int;
  v_leaked  int;
  v_owner   int;
begin
  select count(*) into v_perm from public.permission where code = 'process:delivery:followup';
  if v_perm <> 1 then
    raise exception 'M125: the capability is not in the catalog (% rows) — an uncataloged permission grants nothing and fails silently', v_perm;
  end if;

  select count(*) into v_roles
  from public.role where code in ('ACCOUNT_MANAGER', 'OPS_SUPERVISOR', 'SYSTEM_ADMIN');

  select count(*) into v_granted
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where p.code = 'process:delivery:followup';

  if v_granted <> v_roles then
    raise exception 'M125: expected % grants of process:delivery:followup, got %', v_roles, v_granted;
  end if;

  -- TMS-4 / TMS-5, unmodified and re-proved here: the Account Manager gains a
  -- workflow capability, never Transport execution authority.
  select count(*) into v_leaked
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'ACCOUNT_MANAGER'
    and p.code in ('transport:complete', 'transport:assign', 'transport:create',
                   'transport:manage', 'transport:delete');

  if v_leaked <> 0 then
    raise exception 'M125: ACCOUNT_MANAGER holds % Transport execution grant(s) — TMS-4 forbids this', v_leaked;
  end if;

  -- The premise: step 16 is still the Account Manager's. If a later change
  -- reassigns it, this capability needs revisiting rather than silently
  -- outliving its reason.
  select count(*) into v_owner
  from public.process_step_owning_role
  where step_key = 'am_delivery_followup' and role_code = 'ACCOUNT_MANAGER';

  if v_owner <> 1 then
    raise exception 'M125: step 16 is no longer owned by ACCOUNT_MANAGER (% rows) — revisit this capability', v_owner;
  end if;

  raise notice 'M125 OK: process:delivery:followup catalogued and granted to % role(s); no Transport authority leaked', v_granted;
end $$;
