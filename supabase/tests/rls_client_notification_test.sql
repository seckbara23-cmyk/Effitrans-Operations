-- RLS + dedup regression — Customer notifications (Phase 2.5). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves:
--   * DEDUP: a second client_notification with the same (tenant, dedup_key) is
--     rejected by the unique index (double release / webhook retry → one only). -> blocked
--   * RLS ISOLATION: portal user A sees their own client's notification        -> 1
--     portal user B (different client) does NOT                                 -> 0
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'clia@test.local'),
  ('00000000-0000-0000-0000-00000000aa02', 'clib@test.local')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000001', 'Client B')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca01', 'clia@test.local', 'ACTIVE', 'CLIENT_USER'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca02', 'clib@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.client_notification (id, tenant_id, client_id, event_type, category, title, body, dedup_key) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca01', 'customs_cleared', 'shipment', 'Marchandise dédouanée', 'Votre marchandise a été dédouanée.', 'customs_cleared:fileA')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare dup_blocked int := 0; a_sees int; b_sees int;
begin
  -- Dedup: same (tenant, dedup_key) rejected.
  begin
    insert into public.client_notification (tenant_id, client_id, event_type, category, title, body, dedup_key)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca01', 'customs_cleared', 'shipment', 'dup', 'dup', 'customs_cleared:fileA');
  exception when unique_violation then dup_blocked := 1; when others then dup_blocked := 1; end;

  perform set_config('role', 'authenticated', true);

  -- Portal user A (own client) sees the notification.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000aa01','role','authenticated')::text, true);
  select count(*) into a_sees from public.client_notification where id = '00000000-0000-0000-0000-0000000c0001';

  -- Portal user B (different client) does NOT.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000aa02','role','authenticated')::text, true);
  select count(*) into b_sees from public.client_notification where id = '00000000-0000-0000-0000-0000000c0001';

  perform set_config('role', 'postgres', true);

  insert into _r values ('dup_blocked', dup_blocked), ('a_sees', a_sees), ('b_sees', b_sees);
  if dup_blocked <> 1 or a_sees <> 1 or b_sees <> 0 then
    raise exception 'CLIENT NOTIFICATION FAIL: dup=% a=% b=%', dup_blocked, a_sees, b_sees;
  end if;
end $$;

select * from _r order by check_name;
rollback;
