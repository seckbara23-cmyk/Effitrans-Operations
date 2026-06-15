-- RLS regression test — Portal Invoices (Phase 1.12B). Non-destructive.
-- ---------------------------------------------------------------------------
-- A portal user sees an invoice ONLY when it is ISSUED/PARTIALLY_PAID/PAID on
-- their own client's dossier; lines + payments inherit invoice visibility:
--   * ISSUED own client       -> 1     * PAID own client      -> 1
--   * DRAFT                    -> 0     * VOID                 -> 0
--   * ISSUED OTHER client      -> 0
--   * line/payment of ISSUED   -> 1     * line of DRAFT        -> 0
--   * staff (finance:read) sees the DRAFT (staff unaffected)  -> 1
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'fstaff@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'fportal@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'fstaff@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1e1', '00000000-0000-0000-0000-000000000001', 'Client E1'),
  ('00000000-0000-0000-0000-00000000c1e2', '00000000-0000-0000-0000-000000000001', 'Client E2')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c1e1', 'fportal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fae1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-81001', 'IMP', '00000000-0000-0000-0000-00000000c1e1'),
  ('00000000-0000-0000-0000-00000000fae2', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-81002', 'IMP', '00000000-0000-0000-0000-00000000c1e2')
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000091e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fae1', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000091e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fae1', 'DRAFT'),
  ('00000000-0000-0000-0000-0000000091e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fae1', 'VOID'),
  ('00000000-0000-0000-0000-0000000091e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fae1', 'PAID'),
  ('00000000-0000-0000-0000-0000000091e5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fae2', 'ISSUED')
on conflict (id) do nothing;

insert into public.invoice_line (id, tenant_id, invoice_id, description, unit_amount) values
  ('00000000-0000-0000-0000-00000001a1e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000091e1', 'Service', 1000),
  ('00000000-0000-0000-0000-00000001a1e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000091e2', 'Draft line', 500)
on conflict (id) do nothing;

insert into public.payment (id, tenant_id, invoice_id, amount, method) values
  ('00000000-0000-0000-0000-00000001a2e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000091e1', 400, 'CASH')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  p_issued int; p_paid int; p_draft int; p_void int; p_other int;
  p_line int; p_line_draft int; p_pay int; staff_draft int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into p_issued from public.invoice where id='00000000-0000-0000-0000-0000000091e1';
  select count(*) into p_paid   from public.invoice where id='00000000-0000-0000-0000-0000000091e4';
  select count(*) into p_draft  from public.invoice where id='00000000-0000-0000-0000-0000000091e2';
  select count(*) into p_void   from public.invoice where id='00000000-0000-0000-0000-0000000091e3';
  select count(*) into p_other  from public.invoice where id='00000000-0000-0000-0000-0000000091e5';
  select count(*) into p_line       from public.invoice_line where id='00000000-0000-0000-0000-00000001a1e1';
  select count(*) into p_line_draft from public.invoice_line where id='00000000-0000-0000-0000-00000001a1e2';
  select count(*) into p_pay        from public.payment where id='00000000-0000-0000-0000-00000001a2e1';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into staff_draft from public.invoice where id='00000000-0000-0000-0000-0000000091e2';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('portal_issued', p_issued), ('portal_paid', p_paid), ('portal_draft', p_draft),
    ('portal_void', p_void), ('portal_other_client', p_other),
    ('portal_line', p_line), ('portal_line_draft', p_line_draft), ('portal_payment', p_pay),
    ('staff_sees_draft', staff_draft);

  if p_issued<>1 or p_paid<>1 or p_draft<>0 or p_void<>0 or p_other<>0
     or p_line<>1 or p_line_draft<>0 or p_pay<>1 or staff_draft<>1 then
    raise exception 'RLS PORTAL INV FAIL: issued=% paid=% draft=% void=% other=% line=% lineDraft=% pay=% staffDraft=%',
      p_issued, p_paid, p_draft, p_void, p_other, p_line, p_line_draft, p_pay, staff_draft;
  end if;
end $$;

select * from _r order by check_name;
rollback;
