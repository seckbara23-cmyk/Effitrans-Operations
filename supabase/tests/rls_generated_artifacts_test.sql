-- RLS regression test — generated artifacts & upload integrity (WES-4G).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
--   * finalize writes the row and the event atomically                        -> 1/1
--   * the artifact is VERIFIED on creation and carries its hashes             -> 1
--   * regeneration creates v2 and supersedes v1, both directions              -> 1/1
--   * the superseded version keeps its bytes and its hash                     -> 1
--   * a MANUAL upload may not supersede a generated artifact                  -> raises
--   * finalization without a content hash is refused                          -> raises
--   * a failed EVENT rolls the whole finalization back                        -> 0
--   * the source snapshot never reaches business_event                        -> 0
--   * tenant B cannot read tenant A's artifacts                               -> 0
--   * a portal user cannot read an internal artifact                          -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000e4', 'Test Tenant W4G', 'SN')
on conflict (id) do nothing;

-- G1 = tenant-A staff · G2 = tenant-W4G probe · G3 = tenant-A portal user
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'w4g-g1@test.local'),
  ('00000000-0000-0000-0000-00000000e002', 'w4g-g2@test.local'),
  ('00000000-0000-0000-0000-00000000e003', 'w4g-g3@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001', 'w4g-g1@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000e4', 'w4g-g2@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000e001', r.id, r.tenant_id
from public.role r
where r.code = 'DOCUMENTATION_OFFICER' and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-000000000001', 'W4G Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000cc', 'w4g-g3@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  v_file uuid := '00000000-0000-0000-0000-00000000e410';
  v_a1   uuid := '00000000-0000-0000-0000-00000000e420';
  v_a2   uuid := '00000000-0000-0000-0000-00000000e421';
  v_up   uuid := '00000000-0000-0000-0000-00000000e422';
  v_fail uuid := '00000000-0000-0000-0000-00000000e423';
  row_written int; event_written int; verified_with_hash int;
  v2_version int; superseded_fwd int; superseded_bwd int;
  old_bytes_intact int;
  manual_supersede_rejected int := 0; no_hash_rejected int := 0;
  rollback_rows int; snapshot_in_event int;
  g2_sees int; g3_sees int;
begin
  perform set_config('role', 'postgres', true);

  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
  values (v_file, '00000000-0000-0000-0000-000000000001', 'W4G-TEST-0001', 'IMP',
          '00000000-0000-0000-0000-0000000000cc', 'IN_PROGRESS');

  -- ------------------------------------------------------------- generation
  perform public.finalize_generated_artifact(
    v_a1, '00000000-0000-0000-0000-000000000001', v_file,
    'TRANSPORT_ORDER', 'TRANSPORT_ORDER', 'w4g/a1.pdf',
    'hash-content-v1', 'hash-source-v1',
    jsonb_build_object('fileNumber', 'W4G-TEST-0001', 'driverName', 'Moussa Diop'),
    'wes4g-1', 'AUTHENTICATED_DRIVER',
    '00000000-0000-0000-0000-00000000e001', 1024, null);

  select count(*) into row_written from public.document where id = v_a1;
  select count(*) into event_written from public.business_event
   where subject_id = v_a1 and event_type = 'INTERNAL_DOCUMENT_GENERATED';
  select count(*) into verified_with_hash from public.document
   where id = v_a1 and status = 'VERIFIED'
     and content_sha256 = 'hash-content-v1' and source_sha256 = 'hash-source-v1'
     and artifact_code = 'TRANSPORT_ORDER' and generated_by is not null;

  -- The snapshot stays on the row; it must not reach the ledger.
  select count(*) into snapshot_in_event from public.business_event
   where subject_id = v_a1 and metadata::text like '%Moussa%';

  -- ---------------------------------------------------------- regeneration
  perform public.finalize_generated_artifact(
    v_a2, '00000000-0000-0000-0000-000000000001', v_file,
    'TRANSPORT_ORDER', 'TRANSPORT_ORDER', 'w4g/a2.pdf',
    'hash-content-v2', 'hash-source-v2',
    jsonb_build_object('fileNumber', 'W4G-TEST-0001', 'driverName', 'Awa Fall'),
    'wes4g-1', 'AUTHENTICATED_DRIVER',
    '00000000-0000-0000-0000-00000000e001', 2048, null);

  select version into v2_version from public.document where id = v_a2;
  select count(*) into superseded_fwd from public.document
   where id = v_a1 and superseded_by_id = v_a2 and status = 'SUPERSEDED';
  select count(*) into superseded_bwd from public.document
   where id = v_a2 and supersedes_id = v_a1;
  -- v1 keeps its own bytes and hash: a regeneration never rewrites history.
  select count(*) into old_bytes_intact from public.document
   where id = v_a1 and storage_path = 'w4g/a1.pdf' and content_sha256 = 'hash-content-v1';

  -- ------------------------------------------------- manual replacement ban
  begin
    insert into public.document (id, tenant_id, file_id, type_code, storage_path,
                                 uploaded_by, status, supersedes_id)
    values (v_up, '00000000-0000-0000-0000-000000000001', v_file, 'TRANSPORT_ORDER',
            'w4g/manual.pdf', '00000000-0000-0000-0000-00000000e001', 'UPLOADED', v_a2);
  exception when others then manual_supersede_rejected := 1;
  end;

  -- ----------------------------------------------------------- hash required
  begin
    perform public.finalize_generated_artifact(
      v_fail, '00000000-0000-0000-0000-000000000001', v_file,
      'DEMANDE_TRANSPORT', 'DEMANDE_TRANSPORT', 'w4g/x.pdf',
      '', 'hash-source-x', '{}'::jsonb, 'wes4g-1', 'NO_DRIVER',
      '00000000-0000-0000-0000-00000000e001', 10, null);
  exception when others then no_hash_rejected := 1;
  end;

  -- ------------------------------------------- failed event rolls back all
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$ begin raise exception 'ledger unavailable'; end; $body$;
  $fn$;

  begin
    perform public.finalize_generated_artifact(
      '00000000-0000-0000-0000-00000000e424', '00000000-0000-0000-0000-000000000001', v_file,
      'DEMANDE_TRANSPORT', 'DEMANDE_TRANSPORT', 'w4g/rb.pdf',
      'hash-rb', 'hash-src-rb', '{}'::jsonb, 'wes4g-1', 'NO_DRIVER',
      '00000000-0000-0000-0000-00000000e001', 10, null);
  exception when others then null;
  end;
  select count(*) into rollback_rows from public.document
   where id = '00000000-0000-0000-0000-00000000e424';

  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$
    declare v_id uuid;
    begin
      insert into public.business_event (
        tenant_id, event_type, event_domain, event_version, source,
        dossier_id, subject_type, subject_id, actor_user_id,
        correlation_id, causation_id, metadata)
      values (
        p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
        p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
        p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb))
      returning id into v_id;
      return v_id;
    end; $body$;
  $fn$;

  -- ---------------------------------------------------------------- isolation
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e002','role','authenticated')::text, true);
  select count(*) into g2_sees from public.document where id = v_a2;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e003','role','authenticated')::text, true);
  select count(*) into g3_sees from public.document where id = v_a2;

  perform set_config('role', 'postgres', true);

  raise notice 'WES-4G: row=% event=% verified=% v2=% fwd=% bwd=% intact=% manual=% nohash=% rb=% snap=% g2=% g3=%',
    row_written, event_written, verified_with_hash, v2_version, superseded_fwd,
    superseded_bwd, old_bytes_intact, manual_supersede_rejected, no_hash_rejected,
    rollback_rows, snapshot_in_event, g2_sees, g3_sees;

  insert into _r values
    ('artifact_row_written', row_written),
    ('generation_event_written', event_written),
    ('verified_with_hashes', verified_with_hash),
    ('regeneration_version', v2_version),
    ('supersede_forward', superseded_fwd),
    ('supersede_backward', superseded_bwd),
    ('old_version_bytes_intact', old_bytes_intact),
    ('manual_supersede_rejected', manual_supersede_rejected),
    ('missing_hash_rejected', no_hash_rejected),
    ('failed_event_rolls_back', rollback_rows),
    ('snapshot_never_in_event', snapshot_in_event),
    ('cross_tenant_sees_artifact', g2_sees),
    ('portal_sees_internal_artifact', g3_sees);

  if row_written <> 1 or event_written <> 1 or verified_with_hash <> 1
     or v2_version <> 2 or superseded_fwd <> 1 or superseded_bwd <> 1
     or old_bytes_intact <> 1 or manual_supersede_rejected <> 1
     or no_hash_rejected <> 1 or rollback_rows <> 0 or snapshot_in_event <> 0
     or g2_sees <> 0 or g3_sees <> 0
  then
    raise exception 'RLS WES-4G FAIL — see the NOTICE line above for every value';
  end if;
end $$;

select * from _r order by check_name;
rollback;
