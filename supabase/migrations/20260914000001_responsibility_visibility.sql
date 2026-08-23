-- ===========================================================================
-- F-1 — RESPONSIBILITY-DERIVED DOSSIER READ VISIBILITY (ratified 2026-08-23)
-- ===========================================================================
-- THE INVARIANT THE PLATFORM NEVER HAD. Every existing read ground answers
-- "is this dossier attached to you personally?" — you own it, created it, hold
-- an assigned task or step, appear in its history — or short-circuits on the
-- blunt file:read:all. The audit found 16 of 26 official steps whose RESPONSIBLE
-- role cannot open the dossier while the step is unassigned, which is the normal
-- state right after a handoff. EFT-IMP-2026-00007 is the evidence: its Chef de
-- Transit received the dossier and thereby LOST the ability to open it, because
-- migration 121's handoff ground expires exactly when responsibility begins.
--
-- THE RULE. A dossier is readable when it has an OPEN official step whose
-- authoritative owning role the user holds in this tenant AND that step is
-- UNASSIGNED.
--
-- ASSIGNEE NARROWING (ratified). The clause is deliberately restricted to
-- `assigned_user_id is null`. Once a step is claimed, ordinary owning-role
-- visibility stops there and the assignee's own access comes from the
-- PRE-EXISTING WES-3B ground (e.assigned_user_id = p_user). So narrowing is
-- achieved by subtraction, not by a second rule — a different ordinary holder of
-- the same role is denied, with no new logic to keep in step.
--
-- NO INVENTED MANAGERIAL ACCESS. The seed carries exactly ONE role per step: the
-- registry's own `role`, mapped through ROLE_MAPPINGS to its tenant code.
-- Supervisory roles are NOT added here; where oversight is legitimate it already
-- exists as file:read:all, and this migration does not extend it.
--
-- READ ONLY. Reception, transitions, assignment, document/customs/financial
-- mutation, client ownership, approval, validation and closure all keep their
-- own server-side permission checks. Nothing here grants any of them.
--
-- EXPIRES. Only OPEN states qualify (AVAILABLE, ACTIVE, BLOCKED, SUBMITTED), so
-- a completed, skipped, rejected or cancelled step grants nothing.
--
-- BUILT FROM THE LIVE FUNCTION. Migration 121 was written from the original
-- 2026-06 body and silently deleted four grounds added since; create-or-replace
-- replaces, it does not merge. Its self-assertions passed because they knew only
-- the same four. This body was read back from production with pg_get_functiondef
-- and every ground is asserted individually below.
-- ===========================================================================

-- ------------------------------------------------------- owning-role map ----
create table if not exists public.process_step_owning_role (
  step_key  text not null,
  role_code text not null,
  note      text,
  primary key (step_key, role_code)
);

comment on table public.process_step_owning_role is
  'Registry projection: the authoritative OWNING tenant role for each official process step. Global catalog (no tenant_id), read-only to the application, mirrored from lib/process/effitrans-process.ts via ROLE_MAPPINGS. Confers READ derivation only, never mutation authority.';

alter table public.process_step_owning_role enable row level security;

drop policy if exists process_step_owning_role_select on public.process_step_owning_role;
create policy process_step_owning_role_select on public.process_step_owning_role
  for select to authenticated using (true);

grant select on public.process_step_owning_role to authenticated, service_role;

-- step_key -> authoritative OWNING tenant role (one row per official step).
insert into public.process_step_owning_role (step_key, role_code, note) values
  ('cotation', 'QUOTATION_MANAGER', 'step 1 — cotation'),
  ('operations_intake', 'OPS_SUPERVISOR', 'step 2 — operations'),
  ('am_dossier_opening', 'ACCOUNT_MANAGER', 'step 3 — account_management'),
  ('coordinator_reception', 'CHIEF_OF_TRANSIT', 'step 4 — transit'),
  ('transit_declarant_assignment', 'CHIEF_OF_TRANSIT', 'step 5 — transit'),
  ('customs_preparation', 'CUSTOMS_DECLARANT', 'step 6 — customs_declaration'),
  ('transit_validation', 'CHIEF_OF_TRANSIT', 'step 7 — transit'),
  ('coordinator_to_finance', 'COORDINATOR', 'step 8 — coordination'),
  ('gainde_registration', 'CUSTOMS_FINANCE_OFFICER', 'step 9 — finance_customs'),
  ('coordinator_to_declarant', 'COORDINATOR', 'step 10 — coordination'),
  ('gainde_document_submission', 'CUSTOMS_DECLARANT', 'step 11 — customs_declaration'),
  ('customs_followup', 'COORDINATOR', 'step 12 — coordination'),
  ('customs_field_clearance', 'CUSTOMS_FIELD_AGENT', 'step 13 — customs_field'),
  ('transport_assignment', 'TRANSPORT_OFFICER', 'step 14 — transport'),
  ('pickup', 'PICKUP_AGENT', 'step 15 — pickup'),
  ('am_delivery_followup', 'ACCOUNT_MANAGER', 'step 16 — account_management'),
  ('transport_pod_handoff', 'COORDINATOR', 'step 17 — coordination'),
  ('coordinator_completeness', 'COORDINATOR', 'step 18 — coordination'),
  ('am_completeness', 'ACCOUNT_MANAGER', 'step 19 — account_management'),
  ('billing_draft', 'BILLING_OFFICER', 'step 20 — billing'),
  ('finance_invoice_validation', 'FINANCE_OFFICER', 'step 21 — finance'),
  ('billing_dispatch', 'BILLING_OFFICER', 'step 22 — billing'),
  ('administration_deposit_prep', 'ADMINISTRATIVE_OFFICER', 'step 23 — administration'),
  ('courier_deposit', 'COURIER', 'step 24 — courier'),
  ('administration_proof_handoff', 'ADMINISTRATIVE_OFFICER', 'step 25 — administration'),
  ('collections', 'COLLECTIONS_OFFICER', 'step 26 — collections')
on conflict (step_key, role_code) do nothing;

-- ------------------------------------------------------- visibility rule ----
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
      -- explicit governance permission
      exists (select 1 from public.get_user_permissions(p_user) gp where gp.code = 'file:read:all')
      -- commercial ownership
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.created_by = p_user
      -- CANONICAL operational ownership (WES-3G)
      or exists (
        select 1 from public.process_instance pi
         where pi.file_id = f.id and pi.owner_user_id = p_user)
      -- current work assignment: task …
      or exists (
        select 1 from public.task t
         where t.file_id = f.id and t.assigned_to = p_user)
      -- … or step execution (WES-3B)
      or exists (
        select 1 from public.process_step_execution e
          join public.process_instance pi on pi.id = e.process_instance_id
         where pi.file_id = f.id and e.assigned_user_id = p_user)
      -- BOUNDED historical relationship: this user was verifiably assigned work
      -- on this dossier before. Read from the append-only ledger, so it cannot
      -- be claimed by merely holding a role.
      or exists (
        select 1 from public.assignment_event ae
         where ae.file_id = f.id
           and (ae.new_user_id = p_user or ae.previous_user_id = p_user))
      -- DEPARTMENT INVOLVEMENT — Customs only.
      --
      -- Legitimate involvement, not current responsibility: a customs officer
      -- must find the dossiers their department's work touches, including ones
      -- that have moved on to Finance or been archived. The role check is
      -- tenant-scoped too, so a role held in another tenant grants nothing here.
      or (
        exists (
          select 1
            from public.user_role ur
            join public.role r on r.id = ur.role_id
           where ur.user_id = p_user
             and ur.tenant_id = p_tenant
             and r.code in ('CUSTOMS_DECLARANT', 'CHIEF_OF_TRANSIT', 'CUSTOMS_FIELD_AGENT')
        )
        and exists (
          select 1
            from public.customs_record c
           where c.file_id = f.id
             and c.tenant_id = p_tenant
             and c.deleted_at is null
             and c.required = true
        )
      )
      -- ================= NEW (2026-08-23): handoff-receiver visibility =======
      -- A user who staffs the authorized receiving role of a currently OPEN
      -- ('SENT') handoff may READ that dossier, for as long as it stays open.
      -- Read only, this dossier only, and it expires on reception.
      or exists (
        select 1
        from public.process_handoff h
        join public.process_instance pi2
          on pi2.id = h.process_instance_id
         and pi2.tenant_id = p_tenant
        join public.process_step_receiving_role sr
          on sr.step_key = h.to_step_key
        join public.role r2
          on r2.code = sr.role_code
         and r2.tenant_id = p_tenant
        join public.user_role ur2
          on ur2.role_id = r2.id
         and ur2.user_id = p_user
         and ur2.tenant_id = p_tenant
        where pi2.file_id = f.id
          and h.tenant_id = p_tenant
          and h.status = 'SENT'
      )
      -- ============ NEW (F-1): responsibility-derived visibility ============
      -- An OPEN, UNASSIGNED official step whose owning role the user holds.
      -- Membership alone grants nothing: THIS dossier must carry live work owned
      -- by that role. Assigned steps are excluded on purpose — the assignee is
      -- already covered by the WES-3B ground above, and excluding them here is
      -- what makes ordinary owning-role visibility narrow once a step is claimed.
      or exists (
        select 1
        from public.process_step_execution ex
        join public.process_instance pi3
          on pi3.id = ex.process_instance_id
         and pi3.tenant_id = p_tenant
        join public.process_step_owning_role sor
          on sor.step_key = ex.step_key
        join public.role r3
          on r3.code = sor.role_code
         and r3.tenant_id = p_tenant
        join public.user_role ur3
          on ur3.role_id = r3.id
         and ur3.user_id = p_user
         and ur3.tenant_id = p_tenant
        where pi3.file_id = f.id
          and ex.tenant_id = p_tenant
          and ex.assigned_user_id is null
          and ex.state in ('AVAILABLE', 'ACTIVE', 'BLOCKED', 'SUBMITTED')
      )
    );
$$;

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------- self-assertions ----
do $$
declare
  v_src text;
  v_rows int;
begin
  select count(*) into v_rows from public.process_step_owning_role;
  if v_rows <> 26 then
    raise exception 'MIGRATION FAILED: owning-role map has % rows, expected 26 (one per official step)', v_rows;
  end if;

  if not exists (select 1 from public.process_step_owning_role
                  where step_key = 'coordinator_completeness' and role_code = 'COORDINATOR') then
    raise exception 'MIGRATION FAILED: FD-1 (coordinator_completeness) is not mapped';
  end if;
  if not exists (select 1 from public.process_step_owning_role
                  where step_key = 'courier_deposit' and role_code = 'COURIER') then
    raise exception 'MIGRATION FAILED: FD-2 (courier_deposit) is not mapped';
  end if;
  if not exists (select 1 from public.process_step_owning_role
                  where step_key = 'coordinator_reception' and role_code = 'CHIEF_OF_TRANSIT') then
    raise exception 'MIGRATION FAILED: ratified Transit reception ownership is not mapped';
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'user_readable_file_ids';

  -- EVERY pre-existing ground, asserted individually. Migration 121 lost four
  -- grounds while its own (subset) assertions passed; a subset proves a subset.
  if v_src not like '%file:read:all%' then
    raise exception 'MIGRATION FAILED: lost ground file:read:all';
  end if;
  if v_src not like '%f.account_manager_id = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground account_manager_id';
  end if;
  if v_src not like '%f.coordinator_id = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground coordinator_id';
  end if;
  if v_src not like '%f.created_by = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground created_by';
  end if;
  if v_src not like '%pi.owner_user_id = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground WES-3G operational ownership';
  end if;
  if v_src not like '%t.assigned_to = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground task.assigned_to';
  end if;
  if v_src not like '%e.assigned_user_id = p_user%' then
    raise exception 'MIGRATION FAILED: lost ground WES-3B step assignee';
  end if;
  if v_src not like '%assignment_event ae%' then
    raise exception 'MIGRATION FAILED: lost ground assignment_event history';
  end if;
  if v_src not like '%CUSTOMS_FIELD_AGENT%' or v_src not like '%customs_record c%' then
    raise exception 'MIGRATION FAILED: lost ground customs department involvement';
  end if;
  if v_src not like '%process_step_receiving_role%' or v_src not like '%h.status = ''SENT''%' then
    raise exception 'MIGRATION FAILED: lost ground 121 handoff-receiver visibility';
  end if;

  -- The new ground, with its two limits.
  if v_src not like '%process_step_owning_role%' then
    raise exception 'MIGRATION FAILED: responsibility ground absent';
  end if;
  if v_src not like '%ex.assigned_user_id is null%' then
    raise exception 'MIGRATION FAILED: assignee narrowing absent — owning-role visibility would survive assignment';
  end if;
  if v_src not like '%ex.state in (''AVAILABLE'', ''ACTIVE'', ''BLOCKED'', ''SUBMITTED'')%' then
    raise exception 'MIGRATION FAILED: responsibility ground is not bounded to OPEN states';
  end if;

  raise notice 'F-1 responsibility visibility installed (% owning-role rows)', v_rows;
end $$;
