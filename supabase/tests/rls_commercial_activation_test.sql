-- RLS + invariants test — EC-3C Commercial activation (migration 83). BEGIN/ROLLBACK.
--
-- Proves the thing the whole audit existed for: a supervisor holding ONLY
-- `quotation:validate` can SEE the quotation awaiting validation. Under
-- migration 82's policies they saw nothing, so the validation queue was empty
-- for exactly the person who has to work it.
--
-- Also proves: the ratified matrix is live on the REAL seeded roles; SYSTEM_ADMIN
-- sees zero and holds zero; a holder of neither authority sees zero; the portal
-- sees zero; the maker-checker refuses a self-validation through the RPC AND
-- through a direct UPDATE; and no quotation authority reaches any other role.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c3d1', 'ec3c-agent@test.local'),
  ('00000000-0000-0000-0000-00000000c3d2', 'ec3c-sup@test.local'),
  ('00000000-0000-0000-0000-00000000c3d3', 'ec3c-admin@test.local'),
  ('00000000-0000-0000-0000-00000000c3d4', 'ec3c-none@test.local'),
  ('00000000-0000-0000-0000-00000000c3d5', 'ec3c-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000c3d1', '00000000-0000-0000-0000-000000000001', 'ec3c-agent@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3d2', '00000000-0000-0000-0000-000000000001', 'ec3c-sup@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3d3', '00000000-0000-0000-0000-000000000001', 'ec3c-admin@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3d4', '00000000-0000-0000-0000-000000000001', 'ec3c-none@test.local', 'active')
on conflict (id) do nothing;

-- The REAL seeded roles, not fixtures: this suite is about whether the ratified
-- matrix works, so it must exercise the roles the matrix names.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000c3d1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000c3d2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000c3d3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
-- c3d4 deliberately receives NO role: the "holds neither authority" control.

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c3e9', '00000000-0000-0000-0000-000000000001', 'Client EC3C')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000c3d5', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000c3e9', 'ec3c-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  agent_qm int; sup_val int; sup_create int; admin_grants int; offmatrix int;
  agent_sees int; sup_sees int; admin_sees int; none_sees int; portal_sees int;
  sup_sees_lines int; sup_sees_request int;
  self_validate_rejected int := 0; direct_self_validate_rejected int := 0;
  sup_validated int := 0;
  req uuid; q uuid;
begin
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- 1. THE RATIFIED MATRIX, live on the seeded roles.
  -- ---------------------------------------------------------------------
  select count(*) into agent_qm from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code = 'QUOTATION_MANAGER'
     and p.code in ('quotation:create','quotation:send','quotation:approve');

  select count(*) into sup_val from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code = 'OPS_SUPERVISOR' and p.code = 'quotation:validate';

  -- The refusal DEC-C32 states explicitly: the supervisor is NOT given
  -- quotation:create merely so that quotations become readable.
  select count(*) into sup_create from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code = 'OPS_SUPERVISOR'
     and p.code in ('quotation:create','quotation:send','quotation:approve');

  select count(*) into admin_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.code = 'SYSTEM_ADMIN'
     and p.code in ('quotation:create','quotation:send','quotation:approve','quotation:validate');

  select count(*) into offmatrix from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where p.code in ('quotation:create','quotation:send','quotation:approve','quotation:validate')
     and not ((r.code = 'QUOTATION_MANAGER'
               and p.code in ('quotation:create','quotation:send','quotation:approve'))
           or (r.code = 'OPS_SUPERVISOR' and p.code = 'quotation:validate'));

  -- ---------------------------------------------------------------------
  -- 2. A quotation awaiting validation, prepared BY THE AGENT.
  -- ---------------------------------------------------------------------
  insert into public.quotation_request (id, tenant_id, client_id, subject, opened_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000c3e9', 'Cotation EC3C',
          '00000000-0000-0000-0000-00000000c3d1')
  returning id into req;

  select public.quotation_create('00000000-0000-0000-0000-000000000001', req,
    '00000000-0000-0000-0000-00000000c3d1') into q;

  insert into public.quotation_line
    (tenant_id, quotation_id, position, description, quantity_milli, unit_amount_minor, tax_rate_bp)
  values ('00000000-0000-0000-0000-000000000001', q, 1, 'Transit maritime', 2000, 1500000, 0);

  perform public.quotation_submit('00000000-0000-0000-0000-000000000001', q,
    '00000000-0000-0000-0000-00000000c3d1');

  -- ---------------------------------------------------------------------
  -- 3. VISIBILITY — the defect migration 83 exists to fix.
  -- ---------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  -- The agent (quotation:create) sees it.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3d1','role','authenticated')::text, true);
  select count(*) into agent_sees from public.quotation where id = q;

  -- THE POINT: the supervisor holds ONLY quotation:validate and MUST see it,
  -- together with its lines and its request — you cannot judge an offer whose
  -- lines you cannot read.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3d2','role','authenticated')::text, true);
  select count(*) into sup_sees from public.quotation where id = q;
  select count(*) into sup_sees_lines from public.quotation_line where quotation_id = q;
  select count(*) into sup_sees_request from public.quotation_request where id = req;

  -- SYSTEM_ADMIN sees nothing, because it holds nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3d3','role','authenticated')::text, true);
  select count(*) into admin_sees from public.quotation where id = q;

  -- A staff user with neither authority sees nothing: the widened policy admits
  -- exactly two permissions, not "any authenticated user in the tenant".
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3d4','role','authenticated')::text, true);
  select count(*) into none_sees from public.quotation where id = q;

  -- The portal has no quotation policy at all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3d5','role','authenticated')::text, true);
  select count(*) into portal_sees from public.quotation where id = q;

  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- 4. MAKER-CHECKER, both paths.
  -- ---------------------------------------------------------------------
  begin
    perform public.quotation_validate('00000000-0000-0000-0000-000000000001', q,
      '00000000-0000-0000-0000-00000000c3d1', 'VALIDATED', null);
  exception when others then self_validate_rejected := 1;
  end;

  begin
    -- EXPECT-FAIL: the CHECK constraint refuses it even without the RPC.
    update public.quotation
       set status = 'VALIDATED', validated_by = '00000000-0000-0000-0000-00000000c3d1',
           validated_at = now()
     where id = q;
  exception when others then direct_self_validate_rejected := 1;
  end;

  -- A DIFFERENT actor validates successfully — the rule is separation, not a ban.
  perform public.quotation_validate('00000000-0000-0000-0000-000000000001', q,
    '00000000-0000-0000-0000-00000000c3d2', 'VALIDATED', null);
  select count(*) into sup_validated from public.quotation
   where id = q and status = 'VALIDATED'
     and validated_by = '00000000-0000-0000-0000-00000000c3d2';

  insert into _r values
    ('agent_matrix_grants', agent_qm), ('supervisor_validate_grant', sup_val),
    ('supervisor_create_grants', sup_create), ('system_admin_grants', admin_grants),
    ('off_matrix_grants', offmatrix),
    ('agent_sees', agent_sees), ('validate_only_supervisor_sees', sup_sees),
    ('supervisor_sees_lines', sup_sees_lines), ('supervisor_sees_request', sup_sees_request),
    ('system_admin_sees', admin_sees), ('no_authority_sees', none_sees),
    ('portal_sees', portal_sees),
    ('self_validate_rejected_rpc', self_validate_rejected),
    ('self_validate_rejected_check', direct_self_validate_rejected),
    ('other_actor_validated', sup_validated);

  if agent_qm<>3 or sup_val<>1 or sup_create<>0 or admin_grants<>0 or offmatrix<>0
     or agent_sees<>1 or sup_sees<>1 or sup_sees_lines<>1 or sup_sees_request<>1
     or admin_sees<>0 or none_sees<>0 or portal_sees<>0
     or self_validate_rejected<>1 or direct_self_validate_rejected<>1
     or sup_validated<>1
  then
    raise exception 'EC-3C FAIL: agentGrants=% supValidate=% supCreate=% adminGrants=% offMatrix=% agentSees=% supSees=% supLines=% supReq=% adminSees=% noneSees=% portal=% selfRpc=% selfChk=% otherOk=%',
      agent_qm, sup_val, sup_create, admin_grants, offmatrix,
      agent_sees, sup_sees, sup_sees_lines, sup_sees_request,
      admin_sees, none_sees, portal_sees,
      self_validate_rejected, direct_self_validate_rejected, sup_validated;
  end if;
end $$;

select * from _r order by check_name;
rollback;
