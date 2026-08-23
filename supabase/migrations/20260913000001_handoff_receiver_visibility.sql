-- ===========================================================================
-- Handoff-receiver read visibility (FIN-UAT Failure B, ratified 2026-08-23)
-- ===========================================================================
-- THE DEFECT. A dossier handed to a department was invisible to the very people
-- meant to receive it. `user_readable_file_ids` granted read on four grounds —
-- file:read:all, account_manager_id, coordinator_id, created_by, or an assigned
-- task — and a PENDING HANDOFF is none of them. So the Chef de Transit saw the
-- dossier in the queue, clicked it, and got « Dossier introuvable ».
--
-- THE RULE, and its limits. A user who staffs the authorized receiving role of a
-- currently SENT handoff may READ that dossier, for as long as the handoff is
-- open. That is all:
--   * READ ONLY — reception, transition, assignment, document mutation and
--     client ownership keep their own server-side permission checks. Visibility
--     has never implied authority here and does not start now.
--   * REQUIRES A QUALIFYING HANDOFF — belonging to Transit grants nothing;
--     THIS dossier must have an open handoff aimed at a role the user holds.
--   * EXPIRES ON RECEPTION — status moves off 'SENT' and the derived visibility
--     disappears, unless some other legitimate basis exists.
--   * TENANT-BOUND — every join is pinned to p_tenant, and the outer predicate
--     already restricts to the tenant's own files.
--
-- WHY A BRIDGE TABLE. SQL cannot read the TypeScript process registry, and the
-- two vocabularies differ: the registry says CHIEF_TRANSIT, tenant roles say
-- CHIEF_OF_TRANSIT. The obvious join — process_step_execution.assigned_role_code
-- — is explicitly REJECTED as the authority: it is written when a row is seeded,
-- so live dossiers carry the pre-ratification value (EFT-IMP-2026-00007 still
-- says COORDINATOR) and a stale row would decide who can read. The mapping is
-- therefore explicit, global and declarative, exactly like document_type.
--
-- `coordinator_reception` keeps its legacy key — live executions reference it —
-- but maps to the RATIFIED Transit receiver.
-- ===========================================================================

-- ---------------------------------------------------------------- bridge ----
create table if not exists public.process_step_receiving_role (
  step_key  text not null,
  role_code text not null,
  note      text,
  primary key (step_key, role_code)
);

comment on table public.process_step_receiving_role is
  'Registry projection: which TENANT ROLE CODES may receive a handoff targeting a given official step. Global catalog (no tenant_id), read-only to the application, mirrored from lib/process/queues/registry.ts. Never a source of mutation authority.';

alter table public.process_step_receiving_role enable row level security;

drop policy if exists process_step_receiving_role_select on public.process_step_receiving_role;
create policy process_step_receiving_role_select on public.process_step_receiving_role
  for select to authenticated using (true);

grant select on public.process_step_receiving_role to authenticated, service_role;

-- Seeded for the handoff targets the platform actually sends to. SYSTEM_ADMIN is
-- deliberately absent: it already holds file:read:all, so listing it here would
-- imply this clause is what grants it.
insert into public.process_step_receiving_role (step_key, role_code, note) values
  ('coordinator_reception',        'CHIEF_OF_TRANSIT',     'RATIFIED 2026-08-23: Transit receives the Operations handoff. Legacy step key.'),
  ('coordinator_reception',        'OPS_SUPERVISOR',       'Oversight of the Transit queue.'),
  ('coordinator_to_declarant',     'CUSTOMS_DECLARANT',    'Declarant receives the customs handoff.'),
  ('coordinator_to_declarant',     'OPS_SUPERVISOR',       'Oversight.'),
  ('administration_deposit_prep',  'ADMINISTRATIVE_OFFICER', 'Administration receives the physical-deposit handoff.'),
  ('administration_deposit_prep',  'OPS_SUPERVISOR',       'Oversight.'),
  ('collections',                  'COLLECTIONS_OFFICER',  'Recouvrement receives the proof handoff.'),
  ('collections',                  'FINANCE_OFFICER',      'Finance staffs the collections queue.'),
  ('collections',                  'OPS_SUPERVISOR',       'Oversight.')
on conflict (step_key, role_code) do nothing;

-- ------------------------------------------------------- visibility rule ----
-- Recreated with ONE added disjunct. The four existing grounds are reproduced
-- verbatim: this migration widens visibility, it never narrows it.
create or replace function public.user_readable_file_ids(p_user uuid, p_tenant uuid)
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select f.id
  from public.operational_file f
  where f.tenant_id = p_tenant
    and (
      exists (select 1 from public.get_user_permissions(p_user) gp where gp.code = 'file:read:all')
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.created_by = p_user
      or exists (select 1 from public.task t where t.file_id = f.id and t.assigned_to = p_user)
      -- Handoff-receiver visibility. OPEN handoff ('SENT') only, aimed at a step
      -- whose receiving role this user holds IN THIS TENANT.
      or exists (
        select 1
        from public.process_handoff h
        join public.process_instance pi
          on pi.id = h.process_instance_id
         and pi.tenant_id = p_tenant
        join public.process_step_receiving_role sr
          on sr.step_key = h.to_step_key
        join public.role r
          on r.code = sr.role_code
         and r.tenant_id = p_tenant
        join public.user_role ur
          on ur.role_id = r.id
         and ur.user_id = p_user
         and ur.tenant_id = p_tenant
        where pi.file_id = f.id
          and h.tenant_id = p_tenant
          and h.status = 'SENT'
      )
    );
$$;

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------- self-assertions ----
-- Refuse to report success on a wrong state.
do $$
declare
  v_src text;
  v_rows int;
begin
  select count(*) into v_rows from public.process_step_receiving_role;
  if v_rows < 9 then
    raise exception 'MIGRATION FAILED: bridge seeded % rows, expected >= 9', v_rows;
  end if;

  if not exists (
    select 1 from public.process_step_receiving_role
    where step_key = 'coordinator_reception' and role_code = 'CHIEF_OF_TRANSIT'
  ) then
    raise exception 'MIGRATION FAILED: coordinator_reception does not map to the ratified Transit receiver';
  end if;

  -- SYSTEM_ADMIN must NOT be in the bridge: its access comes from file:read:all.
  if exists (select 1 from public.process_step_receiving_role where role_code = 'SYSTEM_ADMIN') then
    raise exception 'MIGRATION FAILED: SYSTEM_ADMIN must not derive visibility from the handoff clause';
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'user_readable_file_ids';

  -- The four pre-existing grounds survive.
  if v_src not like '%f.account_manager_id = p_user%'
     or v_src not like '%f.coordinator_id = p_user%'
     or v_src not like '%f.created_by = p_user%'
     or v_src not like '%t.assigned_to = p_user%'
     or v_src not like '%file:read:all%' then
    raise exception 'MIGRATION FAILED: an existing visibility ground was lost';
  end if;

  -- The new clause is present, and bounded to OPEN handoffs.
  if v_src not like '%process_step_receiving_role%' then
    raise exception 'MIGRATION FAILED: handoff-receiver clause absent';
  end if;
  if v_src not like '%h.status = ''SENT''%' then
    raise exception 'MIGRATION FAILED: handoff clause is not restricted to OPEN (SENT) handoffs';
  end if;
  -- Stale execution role codes are NOT the authority.
  if v_src like '%assigned_role_code%' then
    raise exception 'MIGRATION FAILED: visibility must not depend on process_step_execution.assigned_role_code';
  end if;

  raise notice 'handoff-receiver visibility installed (% bridge rows)', v_rows;
end $$;
