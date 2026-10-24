-- Privilege / trigger regression test — audit_log TRUNCATE guard (migration 162).
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
-- ---------------------------------------------------------------------------
-- WHAT THIS PROVES BEHAVIOURALLY (the verifier proves the shape):
--   A1  service_role cannot TRUNCATE audit_log, with or without CASCADE —
--       refused for lack of the privilege (42501 on audit_log itself);
--   A2  an authenticated session cannot TRUNCATE it either (42501);
--   A3  the owner's TRUNCATE ... CASCADE is refused BY THE TRIGGER (P0001 naming
--       audit_log). CASCADE matters: expense_visa.audit_log_id is a foreign key
--       to audit_log, and Postgres checks it BEFORE any TRUNCATE trigger, so a
--       plain TRUNCATE is refused by that key (0A000) and proves nothing about
--       the guard. Only CASCADE reaches the trigger;
--   A4  the TRUNCATE layer did not break the legitimate write path: the owner
--       appends, and service_role appends wherever it holds INSERT (production
--       does, through default privileges; CI's migration walk does not); UPDATE
--       and DELETE stay refused;
--   A5  after a broad GRANT of TRUNCATE on every table to service_role (what a
--       fixture or a careless grant would do), its TRUNCATE ... CASCADE is still
--       refused by the trigger — the guarantee does not rest on the REVOKE.
-- Expected: the DO block raises on any mismatch; otherwise the result table is
-- printed and the transaction rolled back (the A5 grant with it).

begin;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  v_before   int;
  v_after    int;
  v_expected int;
  v_sr       text;
  v_sr_casc  text;
  v_auth     text;
  v_owner    text;
  v_owner_m  text;
  v_plain    text;
  v_regrant  text;
  v_regrant_m text;
  v_ins      text;
  v_sr_ins   text;
  v_upd      text;
  v_del      text;
  v_msg      text;
  v_fail     text := '';
begin
  select count(*) into v_before from public.audit_log;

  -- A1 — service_role (bypasses RLS; only the privilege and the trigger stand).
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  begin
    truncate public.audit_log;
    v_sr := 'accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_msg = message_text;
      v_sr := case when v_msg like '%audit_log%' then '42501' else '42501(other:' || v_msg || ')' end;
    when others then
      get stacked diagnostics v_sr = returned_sqlstate;
  end;
  begin
    truncate public.audit_log cascade;
    v_sr_casc := 'accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_msg = message_text;
      v_sr_casc := case when v_msg like '%audit_log%' then '42501' else '42501(other:' || v_msg || ')' end;
    when others then
      get stacked diagnostics v_sr_casc = returned_sqlstate;
  end;
  -- A4 — service_role's write path, where this environment grants it.
  if has_table_privilege('service_role', 'public.audit_log', 'INSERT') then
    begin
      insert into public.audit_log (action, entity) values ('test.audit_truncate_guard.service_role', 'test');
      v_sr_ins := 'inserted';
    exception when others then
      get stacked diagnostics v_sr_ins = returned_sqlstate;
    end;
  else
    v_sr_ins := 'not granted here';
  end if;

  -- A2 — an authenticated session.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000a1001', 'role', 'authenticated')::text, true);
  begin
    truncate public.audit_log;
    v_auth := 'accepted';
  exception when others then
    get stacked diagnostics v_auth = returned_sqlstate;
  end;

  -- A3 / A4 — the owner.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    truncate public.audit_log;
    v_plain := 'accepted';
  exception when others then
    get stacked diagnostics v_plain = returned_sqlstate;
  end;
  begin
    truncate public.audit_log cascade;
    v_owner := 'accepted';
  exception when others then
    get stacked diagnostics v_owner = returned_sqlstate, v_owner_m = message_text;
  end;
  begin
    insert into public.audit_log (action, entity) values ('test.audit_truncate_guard.owner', 'test');
    v_ins := 'inserted';
  exception when others then
    get stacked diagnostics v_ins = returned_sqlstate;
  end;
  begin
    update public.audit_log set entity = 'rewritten' where action = 'test.audit_truncate_guard.owner';
    v_upd := 'accepted';
  exception when others then
    get stacked diagnostics v_upd = returned_sqlstate;
  end;
  begin
    delete from public.audit_log where action = 'test.audit_truncate_guard.owner';
    v_del := 'accepted';
  exception when others then
    get stacked diagnostics v_del = returned_sqlstate;
  end;

  -- A5 — a broad grant restores every privilege: the trigger alone must refuse.
  grant truncate on all tables in schema public to service_role;
  perform set_config('role', 'service_role', true);
  begin
    truncate public.audit_log cascade;
    v_regrant := 'accepted';
  exception when others then
    get stacked diagnostics v_regrant = returned_sqlstate, v_regrant_m = message_text;
  end;
  perform set_config('role', 'postgres', true);

  select count(*) into v_after from public.audit_log;
  v_expected := v_before + (case when v_ins = 'inserted' then 1 else 0 end)
                         + (case when v_sr_ins = 'inserted' then 1 else 0 end);

  insert into _r values
    ('A1_service_role_truncate', v_sr),
    ('A1_service_role_truncate_cascade', v_sr_casc),
    ('A2_authenticated_truncate', v_auth),
    ('A3_owner_truncate_plain', coalesce(v_plain, '?')),
    ('A3_owner_truncate_cascade', v_owner || ' ' || coalesce(v_owner_m, '')),
    ('A4_owner_append', v_ins),
    ('A4_service_role_append', v_sr_ins),
    ('A4_update_refused', v_upd),
    ('A4_delete_refused', v_del),
    ('A5_truncate_with_grant_restored', v_regrant || ' ' || coalesce(v_regrant_m, '')),
    ('rows_before_after', v_before || ' -> ' || v_after);

  if v_sr <> '42501' then v_fail := v_fail || ' A1:' || v_sr; end if;
  if v_sr_casc <> '42501' then v_fail := v_fail || ' A1_cascade:' || v_sr_casc; end if;
  if v_auth <> '42501' then v_fail := v_fail || ' A2:' || v_auth; end if;
  if v_plain = 'accepted' then v_fail := v_fail || ' A3_plain:accepted'; end if;
  if v_owner <> 'P0001' or v_owner_m not like '%TRUNCATE%audit_log%' then
    v_fail := v_fail || ' A3:' || v_owner || ' ' || coalesce(v_owner_m, '');
  end if;
  if v_ins <> 'inserted' then v_fail := v_fail || ' A4_owner_append:' || v_ins; end if;
  if v_sr_ins not in ('inserted', 'not granted here') then v_fail := v_fail || ' A4_sr_append:' || v_sr_ins; end if;
  if v_upd = 'accepted' then v_fail := v_fail || ' A4_update_accepted'; end if;
  if v_del = 'accepted' then v_fail := v_fail || ' A4_delete_accepted'; end if;
  if v_regrant <> 'P0001' or v_regrant_m not like '%TRUNCATE%audit_log%' then
    v_fail := v_fail || ' A5:' || v_regrant || ' ' || coalesce(v_regrant_m, '');
  end if;
  if v_after <> v_expected then v_fail := v_fail || ' rows:' || v_before || '->' || v_after; end if;

  if v_fail <> '' then
    raise exception 'RLS AUDIT LOG TRUNCATE FAIL:%', v_fail;
  end if;
end $$;

select * from _r order by check_name;
rollback;
