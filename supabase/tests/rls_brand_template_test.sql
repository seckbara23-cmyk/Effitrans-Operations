-- RLS: brand_template governance isolation (DBC-6) — bidirectional, non-destructive.
-- Proves the governance table is tenant-isolated both ways + writes are service-role only.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_brand_template_test.sql

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Template Tenant B', 'SN') on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'tpl-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'tpl-b@test.local') on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'tpl-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'tpl-b@test.local') on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN' on conflict do nothing;
insert into public.role (id, tenant_id, code, label_fr, label_en)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2', 'SYSTEM_ADMIN', 'Admin', 'Admin') on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000000f2', p.id from public.permission p where p.code = 'admin:config:manage' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2') on conflict do nothing;

insert into public.brand_template (id, tenant_id, category, template_key, lifecycle_status) values
  ('00000000-0000-0000-0000-0000000ac001', '00000000-0000-0000-0000-000000000001', 'MARKETING_EMAIL', 'ANNOUNCEMENT', 'PUBLISHED'),
  ('00000000-0000-0000-0000-0000000bc001', '00000000-0000-0000-0000-0000000000b2', 'MARKETING_EMAIL', 'ANNOUNCEMENT', 'DRAFT')
on conflict (id) do nothing;

do $$
declare v int; affected int; prevented boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into v from public.brand_template where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v < 1 then raise exception 'A cannot read own brand_template (%)', v; end if;
  select count(*) into v from public.brand_template where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B brand_template (%)', v; end if;
  prevented := false;
  begin
    update public.brand_template set lifecycle_status = 'RETIRED' where tenant_id = '00000000-0000-0000-0000-0000000000b2';
    get diagnostics affected = row_count; prevented := (affected = 0);
  exception when others then prevented := true; end;
  if not prevented then raise exception 'CROSS-TENANT WRITE: A updated B brand_template'; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'brand_template A→B: PASS';
end $$;

do $$
declare v int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
  select count(*) into v from public.brand_template where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v < 1 then raise exception 'B cannot read own brand_template (%)', v; end if;
  select count(*) into v from public.brand_template where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A brand_template (%)', v; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'brand_template B→A: PASS';
  raise notice 'BRAND TEMPLATE RLS: PASS (bidirectional isolation)';
end $$;

rollback;
