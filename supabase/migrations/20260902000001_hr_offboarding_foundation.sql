-- 20260902000001_hr_offboarding_foundation.sql
-- Effitrans HR Platform — HR-8A: offboarding dark foundation.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. Migration 111. Governing specification:
-- docs/hr/hr-8-offboarding-audit.md (verdict GO) + the HR-0F freeze
-- (« clearance gates; equipment return blocks completion; prompts — never
-- silently performs — the 8.1A account archive/ban »).
--
-- THE BOUNDARIES, EACH FROM THE AUDIT:
--
-- 1. OFFBOARDING ≠ TERMINATION (I-8.12). The case governs clearance; the
--    employee lifecycle (transitionEmployee, its reason rule and its
--    « solde de tout compte » document gate) is NOT touched here. Nothing in
--    this migration writes employee, custody, contract, document or app_user
--    rows on its own authority — the completion RPC only READS them as gates.
--
-- 2. THE COMPLETION GATE IS DATABASE-SIDE (I-8.2). hr_complete_offboarding
--    refuses unless, at call time inside the transaction: the employee is
--    TERMINATED, zero custody rows remain open (returned_on is null), and
--    every blocking checklist item is DONE or NOT_APPLICABLE. A stale screen
--    can never satisfy the gate.
--
-- 3. THE ACCOUNT STEP IS A PROMPT, NEVER A CALL (I-8.3). No account write
--    exists below. Completion with a still-unarchived linked account emits
--    the advisory ledger event offboarding_completed_account_active; the
--    8.1A archive stays behind admin:users:manage, which no HR role holds —
--    asserted at apply time (assertion 6d).
--
-- 4. NO NEW AUTHORITY, NO FOUR-EYES, NO INVENTED POLICY. Operating authority
--    is the existing hr:manage (INV-7 in every RPC). This migration catalogues
--    ZERO new permissions (assertion 6f). RQ-8.1–8.8 stay open: reason is
--    free text (RQ-8.1), templates ship empty (RQ-8.2), account and contract
--    gates are advisories not blockers (RQ-8.3/8.4), no dual control
--    (RQ-8.5), cases open only for ACTIVE/SUSPENDED employees (RQ-8.6),
--    the lifecycle's today-stamped termination_date is untouched (RQ-8.7).
--
-- REUSE, NOT PARALLEL MODELS (I-8.10): the existing generic checklist
-- template engine gains a `kind` discriminator (existing rows are truthfully
-- ONBOARDING); the case tables are a SIBLING of the onboarding case tables
-- (labels snapshot at instantiation — editing a template never rewrites what
-- a person was asked to do).
--
-- ERRCODES (HR8xx, mapped in lib/hr/offboarding-actions.ts):
--   HR801 employee not found            HR802 reason required
--   HR803 employee not offboardable     HR804 template invalid
--   HR805 manager invalid               HR806 case already open
--   HR807 invalid item status           HR808 item not found
--   HR809 evidence required             HR810 case not open (item act)
--   HR811 case not found                HR812 case not completable state
--   HR813 employee not TERMINATED       HR814 equipment outstanding
--   HR815 blocking items pending

-- ===========================================================================
-- 1. TEMPLATE KIND — the discriminator on the EXISTING engine (I-8.10).
--    Census before constraint (MAYA-P0.8-A rule): the default backfills every
--    existing row as ONBOARDING, which is what every existing row is.
-- ===========================================================================
alter table public.hr_checklist_template
  add column if not exists kind text not null default 'ONBOARDING';

do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.hr_checklist_template
   where kind not in ('ONBOARDING','OFFBOARDING');
  if v_bad > 0 then
    raise exception 'HR-8A: % checklist template row(s) hold a kind outside the vocabulary — refusing to constrain', v_bad;
  end if;
end $$;

alter table public.hr_checklist_template
  drop constraint if exists hr_checklist_template_kind_check;
alter table public.hr_checklist_template
  add constraint hr_checklist_template_kind_check
  check (kind in ('ONBOARDING','OFFBOARDING'));

-- ===========================================================================
-- 2. OFFBOARDING CASE — sibling of hr_onboarding_case.
--    OPEN → IN_PROGRESS → COMPLETED, with governed CANCELLED (reason).
-- ===========================================================================
create table if not exists public.hr_offboarding_case (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  employee_id            uuid not null references public.employee (id),
  template_id            uuid references public.hr_checklist_template (id),
  status                 text not null default 'OPEN'
                           check (status in ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  planned_departure_date date,
  reason                 text,
  manager_employee_id    uuid references public.employee (id),
  hr_officer_id          uuid references public.app_user (id),
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  cancellation_reason    text,
  summary                text,
  created_by             uuid references public.app_user (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint offboarding_completed_has_date
    check (status <> 'COMPLETED' or completed_at is not null),
  constraint offboarding_cancelled_has_reason
    check (status <> 'CANCELLED' or (cancellation_reason is not null and btrim(cancellation_reason) <> ''))
);
-- One live departure per employee (I-8.5). A departure that was cancelled or
-- completed does not block a new case; rehire is a NEW employee record.
create unique index if not exists uq_offboarding_live_case
  on public.hr_offboarding_case (employee_id)
  where status in ('OPEN','IN_PROGRESS');
create index if not exists idx_offboarding_case_tenant
  on public.hr_offboarding_case (tenant_id, status);
drop trigger if exists trg_hr_offboarding_case_updated_at on public.hr_offboarding_case;
create trigger trg_hr_offboarding_case_updated_at before update on public.hr_offboarding_case
  for each row execute function public.set_updated_at();

-- Instantiated clearance items. Labels are SNAPSHOT at instantiation (I-8.4).
create table if not exists public.hr_offboarding_item (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  case_id              uuid not null references public.hr_offboarding_case (id) on delete cascade,
  item_template_id     uuid references public.hr_checklist_item_template (id),
  position             int not null,
  label_fr             text not null,
  responsible_function text,
  is_required          boolean not null default true,
  is_blocking          boolean not null default true,
  evidence_required    boolean not null default false,
  due_date             date,
  status               text not null default 'PENDING'
                         check (status in ('PENDING','DONE','NOT_APPLICABLE')),
  evidence_document_id uuid references public.hr_document (id),
  comment              text,
  completed_by         uuid references public.app_user (id),
  completed_at         timestamptz,
  constraint offboarding_item_done_has_actor
    check (status <> 'DONE' or (completed_by is not null and completed_at is not null))
);
create index if not exists idx_offboarding_item_case
  on public.hr_offboarding_item (tenant_id, case_id);

-- ===========================================================================
-- 3. TRANSACTIONAL RPCs — actor integrity (HR630) + database authority
--    (INV-7) in every one; service_role transport only.
--    Body comments deliberately absent (INV-3 scans definer sources).
-- ===========================================================================

create or replace function public.hr_open_offboarding_case(
  p_tenant uuid, p_employee uuid, p_actor uuid, p_reason text,
  p_planned_date date default null, p_template uuid default null,
  p_manager uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_emp_status text; v_base date;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif de départ obligatoire' using errcode = 'HR802';
  end if;

  select status into v_emp_status from public.employee
   where id = p_employee and tenant_id = p_tenant for update;
  if not found then
    raise exception 'employé introuvable' using errcode = 'HR801';
  end if;
  if v_emp_status not in ('ACTIVE','SUSPENDED') then
    raise exception 'seul un employé actif ou suspendu peut entrer en départ (statut : %)', v_emp_status
      using errcode = 'HR803';
  end if;

  if p_template is not null and not exists (
    select 1 from public.hr_checklist_template t
     where t.id = p_template and t.tenant_id = p_tenant
       and t.kind = 'OFFBOARDING' and t.is_active) then
    raise exception 'modèle de clôture introuvable ou inadapté' using errcode = 'HR804';
  end if;

  if p_manager is not null and not exists (
    select 1 from public.employee m
     where m.id = p_manager and m.tenant_id = p_tenant) then
    raise exception 'responsable introuvable' using errcode = 'HR805';
  end if;

  if exists (
    select 1 from public.hr_offboarding_case c
     where c.employee_id = p_employee and c.status in ('OPEN','IN_PROGRESS')) then
    raise exception 'un dossier de départ est déjà ouvert pour cet employé' using errcode = 'HR806';
  end if;

  insert into public.hr_offboarding_case (
    tenant_id, employee_id, template_id, planned_departure_date, reason,
    manager_employee_id, hr_officer_id, created_by)
  values (p_tenant, p_employee, p_template, p_planned_date, btrim(p_reason),
          p_manager, p_actor, p_actor)
  returning id into v_id;

  if p_template is not null then
    v_base := coalesce(p_planned_date, current_date);
    insert into public.hr_offboarding_item (
      tenant_id, case_id, item_template_id, position, label_fr,
      responsible_function, is_required, is_blocking, evidence_required, due_date)
    select p_tenant, v_id, it.id, it.position, it.label_fr,
           it.responsible_function, it.is_required, it.is_blocking, it.evidence_required,
           v_base + it.due_offset_days
      from public.hr_checklist_item_template it
     where it.tenant_id = p_tenant and it.template_id = p_template
     order by it.position;
  end if;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, p_employee, 'offboarding_case_opened', p_actor,
          jsonb_build_object('case_id', v_id, 'reason', btrim(p_reason),
                             'planned_departure_date', p_planned_date,
                             'template_id', p_template));
  return v_id;
end $$;

create or replace function public.hr_complete_offboarding_item(
  p_tenant uuid, p_item uuid, p_actor uuid,
  p_status text, p_evidence uuid default null, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_case uuid; v_case_status text; v_employee uuid; v_label text; v_evidence_required boolean;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  if p_status not in ('DONE','NOT_APPLICABLE','PENDING') then
    raise exception 'statut d''élément invalide' using errcode = 'HR807';
  end if;
  select i.case_id, c.status, c.employee_id, i.label_fr, i.evidence_required
    into v_case, v_case_status, v_employee, v_label, v_evidence_required
    from public.hr_offboarding_item i
    join public.hr_offboarding_case c on c.id = i.case_id
   where i.id = p_item and i.tenant_id = p_tenant for update of i, c;
  if not found then
    raise exception 'élément introuvable' using errcode = 'HR808';
  end if;
  if v_case_status not in ('OPEN','IN_PROGRESS') then
    raise exception 'ce dossier de départ n''est plus modifiable' using errcode = 'HR810';
  end if;
  if p_status = 'DONE' and v_evidence_required and p_evidence is null then
    raise exception 'preuve requise pour cet élément' using errcode = 'HR809';
  end if;

  update public.hr_offboarding_item
     set status = p_status,
         evidence_document_id = coalesce(p_evidence, evidence_document_id),
         comment = coalesce(p_comment, comment),
         completed_by = case when p_status = 'PENDING' then null else p_actor end,
         completed_at = case when p_status = 'PENDING' then null else now() end
   where id = p_item;

  if v_case_status = 'OPEN' then
    update public.hr_offboarding_case set status = 'IN_PROGRESS'
     where id = v_case and status = 'OPEN';
  end if;

  if p_status <> 'PENDING' then
    insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
    values (p_tenant, v_employee, 'offboarding_item_completed', p_actor,
            jsonb_build_object('case_id', v_case, 'item', v_label, 'status', p_status));
  end if;
  return p_item;
end $$;

create or replace function public.hr_complete_offboarding(
  p_tenant uuid, p_case uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee uuid; v_status text; v_emp_status text; v_linked uuid;
  v_open_custody int; v_missing text; v_account_status text;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select employee_id, status into v_employee, v_status
    from public.hr_offboarding_case
   where id = p_case and tenant_id = p_tenant for update;
  if not found then
    raise exception 'dossier de départ introuvable' using errcode = 'HR811';
  end if;
  if v_status not in ('OPEN','IN_PROGRESS') then
    raise exception 'ce dossier ne peut pas être clôturé dans son état actuel' using errcode = 'HR812';
  end if;

  select status, linked_app_user_id into v_emp_status, v_linked
    from public.employee where id = v_employee and tenant_id = p_tenant;
  if v_emp_status is distinct from 'TERMINATED' then
    raise exception 'le départ n''est pas encore enregistré au registre (statut : %)', v_emp_status
      using errcode = 'HR813';
  end if;

  select count(*) into v_open_custody
    from public.hr_equipment_assignment a
   where a.tenant_id = p_tenant and a.employee_id = v_employee
     and a.returned_on is null;
  if v_open_custody > 0 then
    raise exception '% équipement(s) non restitué(s) — la restitution se fait dans Équipements', v_open_custody
      using errcode = 'HR814';
  end if;

  select string_agg(label_fr, ', ' order by position) into v_missing
    from public.hr_offboarding_item
   where case_id = p_case and is_blocking and status = 'PENDING';
  if v_missing is not null then
    raise exception 'éléments bloquants non complétés : %', v_missing using errcode = 'HR815';
  end if;

  update public.hr_offboarding_case
     set status = 'COMPLETED', completed_at = now() where id = p_case;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'offboarding_case_completed', p_actor,
          jsonb_build_object('case_id', p_case));

  if v_linked is not null then
    select status into v_account_status from public.app_user where id = v_linked;
    if v_account_status is distinct from 'archived' then
      insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
      values (p_tenant, v_employee, 'offboarding_completed_account_active', p_actor,
              jsonb_build_object('case_id', p_case, 'account_status', v_account_status));
    end if;
  end if;
  return p_case;
end $$;

revoke execute on function public.hr_open_offboarding_case(uuid,uuid,uuid,text,date,uuid,uuid) from public;
revoke execute on function public.hr_complete_offboarding_item(uuid,uuid,uuid,text,uuid,text) from public;
revoke execute on function public.hr_complete_offboarding(uuid,uuid,uuid) from public;
grant execute on function public.hr_open_offboarding_case(uuid,uuid,uuid,text,date,uuid,uuid) to service_role;
grant execute on function public.hr_complete_offboarding_item(uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.hr_complete_offboarding(uuid,uuid,uuid) to service_role;

-- ===========================================================================
-- 4. RLS — read on hr:read, tenant-fenced; NO write policy: the guarded
--    actions and RPCs ARE the write boundary (the HR house pattern).
-- ===========================================================================
alter table public.hr_offboarding_case enable row level security;
alter table public.hr_offboarding_item enable row level security;

drop policy if exists hr_offboarding_case_select on public.hr_offboarding_case;
create policy hr_offboarding_case_select on public.hr_offboarding_case
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_offboarding_item_select on public.hr_offboarding_item;
create policy hr_offboarding_item_select on public.hr_offboarding_item
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_offboarding_case, public.hr_offboarding_item to authenticated;

-- ===========================================================================
-- 5. SELF-ASSERTIONS — the migration refuses to report success if its own
--    contracts do not hold (drift-refusing, the migration-110 idiom).
-- ===========================================================================

-- 6a. The kind discriminator exists with exactly the audited vocabulary.
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
     where constraint_name = 'hr_checklist_template_kind_check'
       and check_clause like '%ONBOARDING%' and check_clause like '%OFFBOARDING%') then
    raise exception 'HR-8A assertion 6a failed: template kind CHECK missing';
  end if;
end $$;

-- 6b. One live case per employee is structural.
do $$
declare v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uq_offboarding_live_case';
  if v_def is null or v_def not ilike '%unique%'
     or v_def not like '%OPEN%' or v_def not like '%IN_PROGRESS%' then
    raise exception 'HR-8A assertion 6b failed: live-case partial unique index missing or weakened';
  end if;
end $$;

-- 6c. The completion gate is database-side: the RPC source (comment-stripped)
--     must test TERMINATED, open custody, and blocking items (I-8.2).
do $$
declare v_src text;
begin
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_offboarding';
  if v_src is null
     or v_src not like '%TERMINATED%'
     or v_src not like '%returned_on is null%'
     or v_src not like '%is_blocking%' then
    raise exception 'HR-8A assertion 6c failed: completion gate weakened (I-8.2)';
  end if;
end $$;

-- 6d. No role may hold BOTH hr:manage and any admin:users:* authority: the
--     account step stays a handoff between two distinct seats (I-8.3).
do $$
declare v_overlap int;
begin
  select count(distinct rp1.role_id) into v_overlap
    from public.role_permission rp1
    join public.permission p1 on p1.id = rp1.permission_id and p1.code = 'hr:manage'
    join public.role_permission rp2 on rp2.role_id = rp1.role_id
    join public.permission p2 on p2.id = rp2.permission_id and p2.code like 'admin:users:%';
  if v_overlap > 0 then
    raise exception 'HR-8A assertion 6d failed: % role(s) hold both hr:manage and admin:users:* (I-8.3)', v_overlap;
  end if;
end $$;

-- 6e. Every HR-8 RPC carries the INV-7 authority check.
do $$
declare v_missing int;
begin
  select count(*) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('hr_open_offboarding_case','hr_complete_offboarding_item','hr_complete_offboarding')
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') not like '%assert_actor_authority%';
  if v_missing > 0 then
    raise exception 'HR-8A assertion 6e failed: % RPC(s) without assert_actor_authority (INV-7)', v_missing;
  end if;
  select 3 - count(*) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('hr_open_offboarding_case','hr_complete_offboarding_item','hr_complete_offboarding');
  if v_missing <> 0 then
    raise exception 'HR-8A assertion 6e failed: RPC census incomplete';
  end if;
end $$;

-- 6f. HR-8A catalogues NO new permission — operating authority is the
--     existing hr:manage, exactly as audited (§9).
do $$
begin
  if exists (select 1 from public.permission where code like 'hr:offboarding%') then
    raise exception 'HR-8A assertion 6f failed: an offboarding permission was catalogued — the audit ratified NONE';
  end if;
end $$;
