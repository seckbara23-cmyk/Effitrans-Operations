-- ===========================================================================
-- TMS-1 — the Responsable client assignment authority, proven live.
-- ---------------------------------------------------------------------------
--   A. INITIAL designation: column + immutable history + business event in one
--      transaction, actor recorded (OBSERVED)
--   B. replacement demands a valid code AND a non-blank detailed reason;
--      « INITIAL » is refused as a replacement motive (TM106)
--   C. owner never vacated (TM102) · owner unchanged refused (TM103) ·
--      inactive or foreign target refused (TM104)
--   D. terminal dossier (CLOSED) refuses (TM105)
--   E. cross-tenant actor refused (HR630) · unauthorized actor refused (EFA15)
--      — including an ACCOUNT_MANAGER holder of file:assign, proving the two
--      authorities are genuinely distinct (D1 = Option A)
--   F. assignment_event is append-only: update and delete both refuse
--   G. self-assignment by the authority runs through the SAME path (D2)
--
-- EFA08 discipline: no jwt claims are held while calling the RPC.
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000ada001', 'tms1-ops@test.local'),
  ('00000000-0000-0000-0000-000000ada002', 'tms1-am@test.local'),
  ('00000000-0000-0000-0000-000000ada003', 'tms1-other@test.local'),
  ('00000000-0000-0000-0000-000000ada004', 'tms1-cand1@test.local'),
  ('00000000-0000-0000-0000-000000ada005', 'tms1-cand2@test.local'),
  ('00000000-0000-0000-0000-000000ada006', 'tms1-inactive@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000adab02', 'TMS-1 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-000000ada001', '00000000-0000-0000-0000-000000000001', 'tms1-ops@test.local', 'active'),
  ('00000000-0000-0000-0000-000000ada002', '00000000-0000-0000-0000-000000000001', 'tms1-am@test.local', 'active'),
  ('00000000-0000-0000-0000-000000ada003', '00000000-0000-0000-0000-000000adab02', 'tms1-other@test.local', 'active'),
  ('00000000-0000-0000-0000-000000ada004', '00000000-0000-0000-0000-000000000001', 'tms1-cand1@test.local', 'active'),
  ('00000000-0000-0000-0000-000000ada005', '00000000-0000-0000-0000-000000000001', 'tms1-cand2@test.local', 'active'),
  ('00000000-0000-0000-0000-000000ada006', '00000000-0000-0000-0000-000000000001', 'tms1-inactive@test.local', 'inactive')
on conflict (id) do nothing;

-- The authority holder: a fixture role carrying the REAL grant, so the EFA15
-- refusal below fails for the right reason, never for a missing fixture.
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-000000adac01', '00000000-0000-0000-0000-000000000001', 'TMS1_OPS', 'Responsable des opérations (test TMS-1)'),
  ('00000000-0000-0000-0000-000000adac02', '00000000-0000-0000-0000-000000000001', 'TMS1_AM', 'Account Manager (test TMS-1)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-000000adac01', p.id from public.permission p where p.code = 'file:assign:commercial'
on conflict do nothing;
-- The AM fixture holds file:assign — the WORKING-ASSIGNEE authority — and must
-- still be refused the commercial act (the Option A separation).
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-000000adac02', p.id from public.permission p where p.code = 'file:assign'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-000000ada001', '00000000-0000-0000-0000-000000adac01', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000ada002', '00000000-0000-0000-0000-000000adac02', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-000000adacc1', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-1)')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status, created_by) values
  ('00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000000001', 'TMS1-0001', 'IMP',
   '00000000-0000-0000-0000-000000adacc1', 'DRAFT', '00000000-0000-0000-0000-000000ada002'),
  ('00000000-0000-0000-0000-000000adaf02', '00000000-0000-0000-0000-000000000001', 'TMS1-0002', 'IMP',
   '00000000-0000-0000-0000-000000adacc1', 'CLOSED', '00000000-0000-0000-0000-000000ada002')
on conflict (id) do nothing;

-- ---- A. INITIAL designation ----------------------------------------------
do $$
declare v_out jsonb; v_am uuid; v_events int; v_biz int;
begin
  v_out := public.assign_commercial_owner(
    '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada004',
    '00000000-0000-0000-0000-000000ada001', 'INITIAL');

  select account_manager_id into v_am from public.operational_file
   where id = '00000000-0000-0000-0000-000000adaf01';
  if v_am is distinct from '00000000-0000-0000-0000-000000ada004' then
    raise exception 'TMS-1: the column must carry the designated Responsable client';
  end if;
  select count(*) into v_events from public.assignment_event
   where subject_type = 'COMMERCIAL_OWNER'
     and subject_id = '00000000-0000-0000-0000-000000adaf01'
     and new_user_id = '00000000-0000-0000-0000-000000ada004'
     and actor_user_id = '00000000-0000-0000-0000-000000ada001'
     and reason_code = 'INITIAL' and provenance = 'OBSERVED';
  if v_events <> 1 then
    raise exception 'TMS-1: the same-transaction OBSERVED history row is missing';
  end if;
  select count(*) into v_biz from public.business_event
   where event_type = 'COMMERCIAL_OWNER_ASSIGNED'
     and dossier_id = '00000000-0000-0000-0000-000000adaf01';
  if v_biz < 1 then
    raise exception 'TMS-1: COMMERCIAL_OWNER_ASSIGNED business event missing';
  end if;
  raise notice 'TMS-1 PASS: INITIAL designation (column + history + event)';
end $$;

-- ---- B. replacement reason semantics --------------------------------------
do $$
begin
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada005',
      '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT');
    raise exception 'TMS-1: a replacement without a detailed reason must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM106' then
      raise exception 'TMS-1: expected TM106 missing reason, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada005',
      '00000000-0000-0000-0000-000000ada001', 'INITIAL', 'peu importe');
    raise exception 'TMS-1: INITIAL must be refused as a replacement motive';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM106' then
      raise exception 'TMS-1: expected TM106 on INITIAL replacement, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.assign_commercial_owner(
    '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada005',
    '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT', 'Départ en congé du responsable initial (test).');
  if (select account_manager_id from public.operational_file
       where id = '00000000-0000-0000-0000-000000adaf01')
     is distinct from '00000000-0000-0000-0000-000000ada005' then
    raise exception 'TMS-1: the motivated replacement must succeed';
  end if;
  if (select count(*) from public.assignment_event
       where subject_type = 'COMMERCIAL_OWNER'
         and subject_id = '00000000-0000-0000-0000-000000adaf01') <> 2 then
    raise exception 'TMS-1: the replacement must append a second history row';
  end if;
  raise notice 'TMS-1 PASS: replacement reason semantics (TM106 x2, then success)';
end $$;

-- ---- C. owner never vacated / unchanged / invalid target ------------------
do $$
begin
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', null,
      '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT', 'x');
    raise exception 'TMS-1: unassignment must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM102' then
      raise exception 'TMS-1: expected TM102, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada005',
      '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT', 'même personne');
    raise exception 'TMS-1: an unchanged owner must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM103' then
      raise exception 'TMS-1: expected TM103, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada006',
      '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT', 'compte inactif');
    raise exception 'TMS-1: an inactive target must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM104' then
      raise exception 'TMS-1: expected TM104 inactive, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada003',
      '00000000-0000-0000-0000-000000ada001', 'REASSIGNMENT', 'hors organisation');
    raise exception 'TMS-1: a foreign-tenant target must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM104' then
      raise exception 'TMS-1: expected TM104 foreign, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'TMS-1 PASS: TM102/TM103/TM104 refusals';
end $$;

-- ---- D. terminal dossier ---------------------------------------------------
do $$
begin
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf02', '00000000-0000-0000-0000-000000ada004',
      '00000000-0000-0000-0000-000000ada001', 'INITIAL');
    raise exception 'TMS-1: a CLOSED dossier must refuse designation';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'TM105' then
      raise exception 'TMS-1: expected TM105 terminal, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'TMS-1 PASS: terminal dossier refusal (TM105)';
end $$;

-- ---- E. authority refusals — including the file:assign holder -------------
do $$
begin
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada004',
      '00000000-0000-0000-0000-000000ada003', 'REASSIGNMENT', 'x');
    raise exception 'TMS-1: a cross-tenant actor must be refused';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'HR630' then
      raise exception 'TMS-1: expected HR630, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.assign_commercial_owner(
      '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada004',
      '00000000-0000-0000-0000-000000ada002', 'REASSIGNMENT', 'je tiens file:assign, pas l''autorité commerciale');
    raise exception 'TMS-1: a file:assign holder must NOT pass the commercial gate (Option A)';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'TMS-1: expected EFA15 for the file:assign holder, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'TMS-1 PASS: authority separation (HR630, EFA15 incl. file:assign holder)';
end $$;

-- ---- F. history immutability ----------------------------------------------
do $$
declare v_id uuid; v_sqlstate text;
begin
  select id into v_id from public.assignment_event
   where subject_type = 'COMMERCIAL_OWNER'
     and subject_id = '00000000-0000-0000-0000-000000adaf01' limit 1;
  begin
    update public.assignment_event set reason = 'réécrit' where id = v_id;
    raise exception 'TMS-1: assignment_event must refuse UPDATE';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
  end;
  begin
    delete from public.assignment_event where id = v_id;
    raise exception 'TMS-1: assignment_event must refuse DELETE';
  exception when others then
    if sqlerrm like 'TMS-1:%' then raise; end if;
  end;
  raise notice 'TMS-1 PASS: history is append-only';
end $$;

-- ---- G. self-assignment through the SAME path (D2) ------------------------
do $$
begin
  perform public.assign_commercial_owner(
    '00000000-0000-0000-0000-000000adaf01', '00000000-0000-0000-0000-000000ada001',
    '00000000-0000-0000-0000-000000ada001', 'SUPERVISOR_INTERVENTION',
    'Je reprends ce dossier comme Responsable client (test).');
  if (select account_manager_id from public.operational_file
       where id = '00000000-0000-0000-0000-000000adaf01')
     is distinct from '00000000-0000-0000-0000-000000ada001' then
    raise exception 'TMS-1: self-assignment must run through the same RPC';
  end if;
  if (select count(*) from public.assignment_event
       where subject_type = 'COMMERCIAL_OWNER'
         and subject_id = '00000000-0000-0000-0000-000000adaf01'
         and new_user_id = actor_user_id) <> 1 then
    raise exception 'TMS-1: the self-assignment must be historised like any other';
  end if;
  raise notice 'TMS-1 PASS: self-assignment via the same path (D2)';
end $$;

rollback;
