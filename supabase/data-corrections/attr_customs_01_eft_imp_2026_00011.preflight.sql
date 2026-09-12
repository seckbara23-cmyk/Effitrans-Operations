-- ATTR-CUSTOMS-01 — READ-ONLY PREFLIGHT for the EFT-IMP-2026-00011 correction.
-- ===========================================================================
-- One SELECT. No insert, update, delete, DDL, role or setting. Safe to run
-- against production at any time:
--
--   npx supabase db query --linked -f supabase/data-corrections/attr_customs_01_eft_imp_2026_00011.preflight.sql
--
-- It reports what the correction would read and change, the provenance it
-- relies on, an affected-row prediction computed with the correction's own
-- predicate, and a tenant-wide census of the same defect signature.
-- ===========================================================================
with target as (
  select '00000000-0000-0000-0000-000000000001'::uuid as tenant_id,
         '7f8e6fb8-aafd-4932-b87a-b34cdca177f3'::uuid as file_id,
         'EFT-IMP-2026-00011'::text                   as file_number,
         '91d80919-8aaa-43cb-a5d3-24002b72850b'::uuid as customs_id,
         '38ff054a-2a14-4f65-bb5a-1902050bc48f'::uuid as overwriter
),
rec as (
  select c.* from public.customs_record c join target t
    on c.id = t.customs_id and c.tenant_id = t.tenant_id and c.file_id = t.file_id
),
validated as (
  select b.id, b.actor_user_id, b.occurred_at, b.source, b.ordinal
    from public.business_event b join target t
      on b.tenant_id = t.tenant_id and b.subject_type = 'customs_record' and b.subject_id = t.customs_id
   where b.event_type = 'CUSTOMS_VALIDATED'
),
customs_events as (
  select b.event_type, b.actor_user_id, u.email as actor_email, b.occurred_at, b.ordinal, b.source
    from public.business_event b join target t
      on b.tenant_id = t.tenant_id and b.subject_type = 'customs_record' and b.subject_id = t.customs_id
    left join public.app_user u on u.id = b.actor_user_id
),
-- The defect signature anywhere in the tenant: a validated record whose
-- reviewed_by is not the actor of its latest validation/recertification event.
census as (
  select c.id, f.file_number, c.reviewed_by, last_v.actor_user_id as validated_by
    from public.customs_record c
    join public.operational_file f on f.id = c.file_id
    cross join lateral (
      select b.actor_user_id from public.business_event b
       where b.subject_type = 'customs_record' and b.subject_id = c.id
         and b.event_type in ('CUSTOMS_VALIDATED', 'CUSTOMS_REVALIDATED')
       order by b.ordinal desc limit 1
    ) last_v
   where c.reviewed_at is not null
     and c.reviewed_by is distinct from last_v.actor_user_id
)
select json_build_object(
  'dossier_number',          (select f.file_number from public.operational_file f join target t on f.id = t.file_id and f.tenant_id = t.tenant_id),
  'dossier_id',              (select file_id from target),
  'customs_record_id',       (select id from rec),
  'current_reviewed_by',     (select reviewed_by from rec),
  'current_reviewed_by_email', (select u.email from rec r join public.app_user u on u.id = r.reviewed_by),
  'reviewed_at',             (select reviewed_at from rec),
  'validated_event_count',   (select count(*) from validated),
  'derived_validator',       (select case when count(*) = 1 then max(actor_user_id::text) end from validated),
  'derived_validator_email', (select u.email from validated v join public.app_user u on u.id = v.actor_user_id),
  'derived_validator_roles', (select json_agg(r.code order by r.code)
                                from validated v
                                join public.user_role ur on ur.user_id = v.actor_user_id
                                join public.role r on r.id = ur.role_id),
  'validated_event',         (select row_to_json(v) from validated v),
  'validation_instant_matches_record', (select v.occurred_at = r.reviewed_at from validated v, rec r),
  'audit_provenance',        (select json_agg(json_build_object('id', a.id, 'actor_id', a.actor_id, 'after', a.after, 'occurred_at', a.occurred_at))
                                from public.audit_log a join target t
                                  on a.tenant_id = t.tenant_id and a.entity = 'customs_record' and a.entity_id = t.customs_id
                               where a.action = 'customs.updated' and a.after ? 'reviewed_by'),
  'correction_or_revalidation_events', (select count(*) from customs_events where event_type in ('CUSTOMS_CORRECTED', 'CUSTOMS_REVALIDATED')),
  'customs_correction_rows', (select count(*) from public.customs_correction c join target t on c.customs_id = t.customs_id),
  'status',                  (select status from rec),
  'release_date',            (select release_date from rec),
  'bae_reference',           (select bae_reference from rec),
  'bae_recorded_by',         (select bae_recorded_by from rec),
  'release_approval_status', (select release_approval_status from rec),
  'release_approval_by',     (select release_approval_by from rec),
  'release_approval_at',     (select release_approval_at from rec),
  'updated_at',              (select updated_at from rec),
  'customs_events',          (select json_agg(e order by e.ordinal) from customs_events e),
  'step13_state',            (select e.state from public.process_step_execution e
                                join public.process_instance i on i.id = e.process_instance_id
                                join target t on i.file_id = t.file_id
                               where e.step_key = 'customs_field_clearance'),
  'transport_records',       (select count(*) from public.transport_record tr join target t on tr.file_id = t.file_id),
  'customs_triggers',        (select json_agg(json_build_object('name', tg.tgname, 'enabled', tg.tgenabled) order by tg.tgname)
                                from pg_trigger tg where tg.tgrelid = 'public.customs_record'::regclass and not tg.tgisinternal),
  'released_by_column_present', (select count(*) = 1 from information_schema.columns
                                  where table_schema = 'public' and table_name = 'customs_record' and column_name = 'released_by'),
  'affected_row_prediction', (select count(*) from public.customs_record c join target t
                                on c.id = t.customs_id and c.tenant_id = t.tenant_id and c.file_id = t.file_id
                              where c.deleted_at is null
                                and c.reviewed_by = t.overwriter
                                and c.reviewed_at = (select occurred_at from validated)
                                and c.status = 'RELEASED'),
  'defect_census',           (select json_agg(row_to_json(x)) from census x),
  'business_event_rows',     (select count(*) from public.business_event),
  'audit_log_rows',          (select count(*) from public.audit_log),
  'ledger_head',             (select max(version) from supabase_migrations.schema_migrations),
  'ledger_rows',             (select count(*) from supabase_migrations.schema_migrations)
) as preflight;
