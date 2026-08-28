-- 20260920000001_customs_governed_data.sql
-- ===========================================================================
-- D4 (RATIFIED 2026-08-28) — the five governed customs data elements, and the
-- correction door that validated data was missing.
--
-- « Déclarant saisit → Chef de Transit valide → toute correction après
--   validation est tracée. »
--
-- PART ONE — the five elements. They feed the heart of ICTD (CDP, NPSH×CCT,
-- U_DPI, U_TE) and did not exist as data anywhere. They are ordinary columns
-- on customs_record, entered through the step-gated `customs:update` path the
-- Déclarant already uses, and certified by the existing validation RPC — no
-- new capture machinery, exactly the machinery the platform already trusts.
-- Vocabularies are the ratified ones: four declaration types (D1 — DPE is not
-- among them and cannot be stored), the four DPI regimes, the three exemption
-- origins, the two classification origins. All nullable: existing records
-- predate the capture and must remain honest about not knowing.
--
-- PART TWO — the correction door. Before this migration, validated customs
-- data was de-facto PERMANENTLY IMMUTABLE: updateCustoms is control-gated to
-- open step states, the owning step is long completed by validation time, and
-- the validation RPC is one-shot. Effitrans explicitly requires traced
-- correction — not unrestricted editing, and not immutability either. So:
--
--   * `record_customs_correction` — Chef de Transit only (`customs:correct`),
--     VALIDATED records only, motif obligatoire. Old values are read
--     server-side inside the same transaction — a caller cannot lie about
--     what was there. The correction clears the validation instant (the data
--     is no longer certified), attributes the edit to the corrector, appends
--     an immutable row to `customs_correction` (WORM-triggered), and emits
--     CUSTOMS_CORRECTED — the mandatory-event pattern: if the ledger refuses,
--     the correction does not happen.
--
--   * `record_customs_revalidation` — the corrected record returns to
--     certified through `customs:revalidate`, held by the Chef de Transit AND
--     the Déclarant en Douane (ratified: either may revalidate). Maker≠checker
--     is person-level, as everywhere in this platform: the CORRECTOR may not
--     certify their own correction. The déclarant certifying the Chef's
--     correction is the clean cross-check — the Chef made the change, a
--     different pair of eyes confirms it. The ordinary validation RPC needs no
--     change: migration 104 already refuses the last editor, and the corrector
--     IS the last editor.
--
-- What this deliberately does NOT do: reopen updateCustoms after validation,
-- grant the Déclarant `customs:validate` (PG-6 stands — first certification
-- remains the Chef's alone), or touch the C-4 workflow semantics.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The five elements.
-- ---------------------------------------------------------------------------
alter table public.customs_record
  add column if not exists sh_position_count int
    check (sh_position_count is null or sh_position_count >= 0),
  add column if not exists declaration_type text
    check (declaration_type is null or declaration_type in ('SIMPLE','APE','DEP','OG')),
  add column if not exists dpi_regime text
    check (dpi_regime is null or dpi_regime in ('SANS_DPI','CLIENT_EXPEDITION','CLIENT_GLOBALE','EFFITRANS')),
  add column if not exists exemption_title_origin text
    check (exemption_title_origin is null or exemption_title_origin in ('SANS_OBJET','CLIENT','EFFITRANS')),
  add column if not exists tariff_classification_origin text
    check (tariff_classification_origin is null or tariff_classification_origin in ('CLIENT','EFFITRANS'));

-- ---------------------------------------------------------------------------
-- 2. The immutable correction history.
-- ---------------------------------------------------------------------------
create table if not exists public.customs_correction (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  customs_id          uuid not null references public.customs_record (id),
  file_id             uuid not null references public.operational_file (id),
  corrected_by        uuid not null references public.app_user (id),
  corrected_at        timestamptz not null default now(),
  reason              text not null check (length(btrim(reason)) > 0),
  -- { "<field>": { "old": …, "new": … }, … } — computed server-side.
  changes             jsonb not null,
  -- The certification this correction displaced, preserved verbatim.
  validated_by_before uuid not null,
  validated_at_before timestamptz not null
);

create index if not exists idx_customs_correction_customs
  on public.customs_correction (tenant_id, customs_id, corrected_at desc);

-- WORM. History that can be edited is not history.
create or replace function public.customs_correction_worm()
returns trigger
language plpgsql
as $$
begin
  raise exception 'customs_correction is append-only: corrections are never rewritten or erased';
end $$;

drop trigger if exists customs_correction_worm on public.customs_correction;
create trigger customs_correction_worm
  before update or delete on public.customs_correction
  for each row execute function public.customs_correction_worm();

alter table public.customs_correction enable row level security;

drop policy if exists customs_correction_select on public.customs_correction;
create policy customs_correction_select on public.customs_correction
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('customs:read'));

grant select on public.customs_correction to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The two narrow capabilities.
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('customs:correct', 'customs', 'correct', 'assigned',
   'Correct VALIDATED customs information through the governed correction door: motif obligatoire, old→new traced, validation cleared for recertification. Confers no ordinary update authority.'),
  ('customs:revalidate', 'customs', 'revalidate', 'assigned',
   'Recertify a customs record after a governed correction. Person-level maker≠checker: the corrector may never revalidate their own correction. Confers no first-validation authority.')
on conflict (code) do nothing;

-- customs:correct — the ruling names the Chef de Transit. SYSTEM_ADMIN for
-- administrative continuity, as elsewhere. NOT the declarant, NOT supervision:
-- correcting certified customs data is the checker role's accountability.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:correct'
where r.code in ('CHIEF_OF_TRANSIT', 'SYSTEM_ADMIN')
on conflict do nothing;

-- customs:revalidate — the ruling names BOTH: « revalidated by either the Chef
-- de Transit or the Déclarant en Douane ». This does not weaken PG-6: first
-- validation still requires customs:validate, which the declarant does not
-- hold; this capability opens only the post-correction recertification, and
-- the RPC refuses the corrector.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:revalidate'
where r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'SYSTEM_ADMIN')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. The correction RPC.
-- ---------------------------------------------------------------------------
create or replace function public.record_customs_correction(
  p_customs_id                   uuid,
  p_actor                        uuid,
  p_reason                       text,
  p_sh_position_count            int,
  p_declaration_type             text,
  p_dpi_regime                   text,
  p_exemption_title_origin       text,
  p_tariff_classification_origin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_by       uuid;
  v_at       timestamptz;
  v_old      record;
  v_changes  jsonb := '{}'::jsonb;
  v_corr     uuid;
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a correction requires a reason';
  end if;

  select tenant_id, file_id, reviewed_by, reviewed_at,
         sh_position_count, declaration_type, dpi_regime,
         exemption_title_origin, tariff_classification_origin
    into v_old
    from public.customs_record
   where id = p_customs_id and deleted_at is null
     for update;
  if not found then raise exception 'customs record not found'; end if;
  v_tenant := v_old.tenant_id; v_file := v_old.file_id;
  v_by := v_old.reviewed_by; v_at := v_old.reviewed_at;

  -- OPS-SEC-2A / INV-7: caller-declared actor, database-verified authority.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:correct', 'SERVICE');

  -- This door exists for CERTIFIED data only. Uncertified data is corrected
  -- where it was entered — the step-gated update path.
  if v_at is null then
    raise exception 'only a validated customs record passes through the correction door';
  end if;

  -- Old values are what THIS transaction read, never what the caller claims.
  if coalesce(v_old.sh_position_count, -1) is distinct from coalesce(p_sh_position_count, -1) then
    v_changes := v_changes || jsonb_build_object('sh_position_count',
      jsonb_build_object('old', v_old.sh_position_count, 'new', p_sh_position_count));
  end if;
  if v_old.declaration_type is distinct from p_declaration_type then
    v_changes := v_changes || jsonb_build_object('declaration_type',
      jsonb_build_object('old', v_old.declaration_type, 'new', p_declaration_type));
  end if;
  if v_old.dpi_regime is distinct from p_dpi_regime then
    v_changes := v_changes || jsonb_build_object('dpi_regime',
      jsonb_build_object('old', v_old.dpi_regime, 'new', p_dpi_regime));
  end if;
  if v_old.exemption_title_origin is distinct from p_exemption_title_origin then
    v_changes := v_changes || jsonb_build_object('exemption_title_origin',
      jsonb_build_object('old', v_old.exemption_title_origin, 'new', p_exemption_title_origin));
  end if;
  if v_old.tariff_classification_origin is distinct from p_tariff_classification_origin then
    v_changes := v_changes || jsonb_build_object('tariff_classification_origin',
      jsonb_build_object('old', v_old.tariff_classification_origin, 'new', p_tariff_classification_origin));
  end if;

  if v_changes = '{}'::jsonb then
    raise exception 'a correction must change something';
  end if;

  -- The correction: new values in, edit attributed, certification cleared.
  -- The CHECK constraints on customs_record are the vocabulary gate.
  update public.customs_record
     set sh_position_count            = p_sh_position_count,
         declaration_type             = p_declaration_type,
         dpi_regime                   = p_dpi_regime,
         exemption_title_origin       = p_exemption_title_origin,
         tariff_classification_origin = p_tariff_classification_origin,
         updated_by                   = p_actor,
         reviewed_by                  = null,
         reviewed_at                  = null
   where id = p_customs_id;

  insert into public.customs_correction
    (tenant_id, customs_id, file_id, corrected_by, reason, changes,
     validated_by_before, validated_at_before)
  values
    (v_tenant, p_customs_id, v_file, p_actor, btrim(p_reason), v_changes, v_by, v_at)
  returning id into v_corr;

  -- Mandatory event: a refused ledger aborts the correction (WES-9).
  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_CORRECTED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object(
      'correction_id', v_corr,
      'fields', (select jsonb_agg(k) from jsonb_object_keys(v_changes) as k),
      'displaced_validation_by', v_by
    )
  );

  return jsonb_build_object('correction_id', v_corr, 'customs_id', p_customs_id, 'file_id', v_file);
end; $$;

revoke execute on function public.record_customs_correction(uuid, uuid, text, int, text, text, text, text) from public;
revoke execute on function public.record_customs_correction(uuid, uuid, text, int, text, text, text, text) from anon;
revoke execute on function public.record_customs_correction(uuid, uuid, text, int, text, text, text, text) from authenticated;
grant  execute on function public.record_customs_correction(uuid, uuid, text, int, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The revalidation RPC.
-- ---------------------------------------------------------------------------
create or replace function public.record_customs_revalidation(
  p_customs_id uuid,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant    uuid;
  v_file      uuid;
  v_at        timestamptz;
  v_corr      uuid;
  v_corrector uuid;
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, reviewed_at
    into v_tenant, v_file, v_at
    from public.customs_record
   where id = p_customs_id and deleted_at is null
     for update;
  if not found then raise exception 'customs record not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:revalidate', 'SERVICE');

  -- This door opens only AFTER a governed correction. First certification is
  -- the ordinary validation and stays the Chef's alone (PG-6).
  select id, corrected_by into v_corr, v_corrector
    from public.customs_correction
   where customs_id = p_customs_id and tenant_id = v_tenant
   order by corrected_at desc
   limit 1;
  if v_corr is null then
    raise exception 'this record was never corrected — use the ordinary validation';
  end if;

  if v_at is not null then
    raise exception 'this customs record is already validated';
  end if;

  -- Person-level maker≠checker: whoever made the correction may not certify it.
  if v_corrector = p_actor then
    raise exception 'the corrector may not revalidate their own correction';
  end if;

  update public.customs_record
     set reviewed_by = p_actor,
         reviewed_at = now()
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_REVALIDATED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object('correction_id', v_corr, 'maker_checked', true)
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file, 'correction_id', v_corr);
end; $$;

revoke execute on function public.record_customs_revalidation(uuid, uuid) from public;
revoke execute on function public.record_customs_revalidation(uuid, uuid) from anon;
revoke execute on function public.record_customs_revalidation(uuid, uuid) from authenticated;
grant  execute on function public.record_customs_revalidation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  -- A CODE census is not a DATA census: prove no existing row violates the
  -- new vocabularies (they are all NULL today, and this proves it).
  select count(*) into v_n from public.customs_record
   where declaration_type is not null
      or dpi_regime is not null
      or exemption_title_origin is not null
      or tariff_classification_origin is not null
      or sh_position_count is not null;
  if v_n <> 0 then
    raise exception 'M128: expected all five governed columns NULL on existing rows, found % populated', v_n;
  end if;

  -- DPE must be unstorable, not merely discouraged (D1). Asserted on the
  -- CONSTRAINT rather than by attempting an insert: customs_record carries a
  -- tenant-consistency trigger (migration 20260615000002) that fires before any
  -- CHECK, so a throwaway probe row proves the trigger works, not the check.
  -- The behavioural proof — an UPDATE to 'DPE' on a properly constituted row —
  -- lives in supabase/tests/customs_d4_correction_test.sql.
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'customs_record'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%declaration_type%'
     and pg_get_constraintdef(c.oid) like '%SIMPLE%';
  if v_n <> 1 then
    raise exception 'M128: expected exactly 1 declaration_type CHECK, found %', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'customs_record'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%declaration_type%'
     and pg_get_constraintdef(c.oid) like '%DPE%';
  if v_n <> 0 then
    raise exception 'M128: the declaration_type CHECK admits DPE — D1 forbids it';
  end if;

  select count(*) into v_n from public.permission
   where code in ('customs:correct','customs:revalidate');
  if v_n <> 2 then
    raise exception 'M128: expected 2 new permissions, found %', v_n;
  end if;

  select count(*) into v_n
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'customs:correct';
  if v_n <> 2 then
    raise exception 'M128: customs:correct must have exactly 2 holders (CHIEF_OF_TRANSIT, SYSTEM_ADMIN), found %', v_n;
  end if;

  select count(*) into v_n
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'customs:revalidate';
  if v_n <> 3 then
    raise exception 'M128: customs:revalidate must have exactly 3 holders, found %', v_n;
  end if;

  -- The declarant did NOT acquire first-validation authority (PG-6 intact).
  select count(*) into v_n
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'customs:validate' and r.code = 'CUSTOMS_DECLARANT';
  if v_n <> 0 then
    raise exception 'M128: CUSTOMS_DECLARANT must not hold customs:validate';
  end if;

  select count(*) into v_n from pg_trigger
   where tgname = 'customs_correction_worm' and not tgisinternal;
  if v_n <> 1 then
    raise exception 'M128: the WORM trigger on customs_correction is missing';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'customs_correction'
     and cmd in ('INSERT','UPDATE','DELETE');
  if v_n <> 0 then
    raise exception 'M128: customs_correction must have NO write policy, found %', v_n;
  end if;

  raise notice 'M128 OK: five governed customs elements added; correction door (customs:correct ×2) and revalidation door (customs:revalidate ×3) created; WORM history in place; PG-6 intact';
end $$;
