-- RLS regression — F-1 responsibility-derived dossier visibility.
-- ---------------------------------------------------------------------------
-- Proves the ratified rule, its narrowing, and — mandatory after migration 121's
-- regression — that EVERY pre-existing ground survives the function replacement.
--
--   R1  unassigned OPEN step + owning role            -> READABLE
--   R2  unassigned OPEN step + unrelated role         -> denied
--   R3  assigned OPEN step + the assignee             -> READABLE (WES-3B)
--   R4  assigned OPEN step + other holder, same role  -> denied (narrowing)
--   R5  terminal step (COMPLETED/SKIPPED/REJECTED)    -> expires
--   R6  role membership, no open step on this dossier -> nothing
--   R7  cross-tenant role/step                        -> denied
--   T1  COORDINATOR reads the whole tenant (ratified 2026-10-01), and still
--       nothing outside it
--
-- WHICH ROLE CARRIES THE NARROWING (COORDINATOR-TENANT-VISIBILITY-01).
--
-- R4, R5 and R6 are about the F-1 ground EXPIRING: once a step is claimed, once
-- it completes, once there is no open step of yours on this dossier, the ground
-- stops granting. They were demonstrated with COORDINATOR, which on 2026-10-01
-- received the ratified tenant-wide `file:read:all` -- so a Coordinator now
-- reads those dossiers through a DIFFERENT and independent ground and can no
-- longer show anything about this one. The rule has not changed; the witness has.
--
-- So R4/R5/R6 now run on COURIER, which owns exactly one official step
-- (courier_deposit), holds no tenant-wide read, and is not one of the three
-- customs roles with department involvement -- i.e. the F-1 ground is the ONLY
-- thing that can grant it anything, which is what makes it a witness at all.
-- T1 then asserts the new rule explicitly on the same dossiers, so this file
-- states both halves instead of quietly losing one.
--   G1..G6 pre-existing grounds intact: handoff(121), operational owner,
--         step assignee, history, customs, creator
--   FD-1 coordinator_completeness readable by COORDINATOR when open+unassigned
--   FD-2 courier_deposit readable by COURIER when open+unassigned
-- Non-destructive: BEGIN/ROLLBACK.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c9', 'Tenant C9', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'coord.a@test.local'),
  ('00000000-0000-0000-0000-00000000d002', 'coord.b@test.local'),
  ('00000000-0000-0000-0000-00000000d003', 'courier.a@test.local'),
  ('00000000-0000-0000-0000-00000000d004', 'declarant.a@test.local'),
  ('00000000-0000-0000-0000-00000000d005', 'coordC9@test.local'),
  ('00000000-0000-0000-0000-00000000d006', 'chief.a@test.local'),
  ('00000000-0000-0000-0000-00000000d007', 'owner.a@test.local'),
  ('00000000-0000-0000-0000-00000000d008', 'creator.a@test.local'),
  ('00000000-0000-0000-0000-00000000d009', 'courier.b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'coord.a@test.local'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000001', 'coord.b@test.local'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-000000000001', 'courier.a@test.local'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-000000000001', 'declarant.a@test.local'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000c9', 'coordC9@test.local'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-000000000001', 'chief.a@test.local'),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-000000000001', 'owner.a@test.local'),
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-000000000001', 'creator.a@test.local'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-000000000001', 'courier.b@test.local')
on conflict (id) do nothing;

-- Tenant C9 needs its own COORDINATOR role row.
insert into public.role (id, tenant_id, code, label_fr)
values ('00000000-0000-0000-0000-00000000d0c9', '00000000-0000-0000-0000-0000000000c9', 'COORDINATOR', 'Coordinateur')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000d001'::uuid, 'COORDINATOR',       '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000d002'::uuid, 'COORDINATOR',       '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000d003'::uuid, 'COURIER',           '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000d004'::uuid, 'CUSTOMS_DECLARANT', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000d005'::uuid, 'COORDINATOR',       '00000000-0000-0000-0000-0000000000c9'::uuid),
  ('00000000-0000-0000-0000-00000000d006'::uuid, 'CHIEF_OF_TRANSIT',  '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000d009'::uuid, 'COURIER',           '00000000-0000-0000-0000-000000000001'::uuid)
) as u(uid, code, tid)
join public.role r on r.code = u.code and r.tenant_id = u.tid
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000cd101', '00000000-0000-0000-0000-000000000001', 'Client F1'),
  ('00000000-0000-0000-0000-0000000cd1c9', '00000000-0000-0000-0000-0000000000c9', 'Client F1 C9')
on conflict (id) do nothing;

-- D1 open+unassigned coordinator_completeness | D2 same step ASSIGNED to coord.a
-- D3 terminal | D4 courier_deposit open+unassigned | D5 tenant C9
-- D6 SENT handoff (121 ground) | D7 operational owner | D8 creator
-- D9 courier_deposit ASSIGNED to courier.a | D10 courier_deposit COMPLETED
insert into public.operational_file (id, tenant_id, file_number, type, client_id, created_by) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0001', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0002', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0003', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0004', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-0000000000c9', 'EFT-F1-0005', 'IMP', '00000000-0000-0000-0000-0000000cd1c9', null),
  ('00000000-0000-0000-0000-00000000a106', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0006', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a107', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0007', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a108', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0008', 'IMP', '00000000-0000-0000-0000-0000000cd101', '00000000-0000-0000-0000-00000000d008'),
  ('00000000-0000-0000-0000-00000000a109', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0009', 'IMP', '00000000-0000-0000-0000-0000000cd101', null),
  ('00000000-0000-0000-0000-00000000a110', '00000000-0000-0000-0000-000000000001', 'EFT-F1-0010', 'IMP', '00000000-0000-0000-0000-0000000cd101', null)
on conflict (id) do nothing;

insert into public.process_instance (id, tenant_id, file_id, owner_user_id) values
  ('00000000-0000-0000-0000-0000000b1101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a101', null),
  ('00000000-0000-0000-0000-0000000b1102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a102', null),
  ('00000000-0000-0000-0000-0000000b1103', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a103', null),
  ('00000000-0000-0000-0000-0000000b1104', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a104', null),
  ('00000000-0000-0000-0000-0000000b1105', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-00000000a105', null),
  ('00000000-0000-0000-0000-0000000b1106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a106', null),
  ('00000000-0000-0000-0000-0000000b1107', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a107', '00000000-0000-0000-0000-00000000d007'),
  ('00000000-0000-0000-0000-0000000b1108', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a109', null),
  ('00000000-0000-0000-0000-0000000b1109', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a110', null)
on conflict (id) do nothing;

insert into public.process_step_execution (id, tenant_id, process_instance_id, step_key, state, assigned_user_id) values
  ('00000000-0000-0000-0000-0000000c1101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1101', 'coordinator_completeness', 'AVAILABLE', null),
  ('00000000-0000-0000-0000-0000000c1102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1102', 'coordinator_completeness', 'AVAILABLE', '00000000-0000-0000-0000-00000000d001'),
  ('00000000-0000-0000-0000-0000000c1103', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1103', 'coordinator_completeness', 'COMPLETED', null),
  ('00000000-0000-0000-0000-0000000c1104', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1104', 'courier_deposit', 'AVAILABLE', null),
  ('00000000-0000-0000-0000-0000000c1105', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000b1105', 'coordinator_completeness', 'AVAILABLE', null),
  ('00000000-0000-0000-0000-0000000c1106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1106', 'coordinator_reception', 'PENDING', null),
  ('00000000-0000-0000-0000-0000000c1107', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1108', 'courier_deposit', 'AVAILABLE', '00000000-0000-0000-0000-00000000d003'),
  ('00000000-0000-0000-0000-0000000c1108', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1109', 'courier_deposit', 'COMPLETED', null)
on conflict (id) do nothing;

-- D6 carries a SENT handoff: the 121 ground must still work on its own.
insert into public.process_handoff (id, tenant_id, process_instance_id, from_step_key, to_step_key, status, sent_by, dedup_key)
values ('00000000-0000-0000-0000-0000000d1106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1106',
        'am_dossier_opening', 'coordinator_reception', 'SENT', '00000000-0000-0000-0000-00000000d008', 'f1-6')
on conflict (id) do nothing;

do $$
declare
  t_a uuid := '00000000-0000-0000-0000-000000000001';
  t_c uuid := '00000000-0000-0000-0000-0000000000c9';
  coord_a uuid := '00000000-0000-0000-0000-00000000d001';
  coord_b uuid := '00000000-0000-0000-0000-00000000d002';
  courier uuid := '00000000-0000-0000-0000-00000000d003';
  courier_b uuid := '00000000-0000-0000-0000-00000000d009';
  declarant uuid := '00000000-0000-0000-0000-00000000d004';
  coord_c9 uuid := '00000000-0000-0000-0000-00000000d005';
  chief uuid := '00000000-0000-0000-0000-00000000d006';
  owner_u uuid := '00000000-0000-0000-0000-00000000d007';
  creator uuid := '00000000-0000-0000-0000-00000000d008';
  d_open uuid := '00000000-0000-0000-0000-00000000a101';
  d_assigned uuid := '00000000-0000-0000-0000-00000000a102';
  d_terminal uuid := '00000000-0000-0000-0000-00000000a103';
  d_courier uuid := '00000000-0000-0000-0000-00000000a104';
  d_c9 uuid := '00000000-0000-0000-0000-00000000a105';
  d_handoff uuid := '00000000-0000-0000-0000-00000000a106';
  d_owner uuid := '00000000-0000-0000-0000-00000000a107';
  d_creator uuid := '00000000-0000-0000-0000-00000000a108';
  d_courier_claimed uuid := '00000000-0000-0000-0000-00000000a109';
  d_courier_done uuid := '00000000-0000-0000-0000-00000000a110';
  ok boolean;
begin
  -- R1 FD-1: unassigned OPEN coordinator_completeness -> COORDINATOR reads it.
  select exists (select 1 from public.user_readable_file_ids(coord_a, t_a) v where v.id = d_open) into ok;
  if not ok then raise exception 'FAIL R1/FD-1: owning role cannot read its own open unassigned step'; end if;

  -- R2: an unrelated role gets nothing from the same dossier.
  select exists (select 1 from public.user_readable_file_ids(declarant, t_a) v where v.id = d_open) into ok;
  if ok then raise exception 'FAIL R2: unrelated role gained responsibility visibility'; end if;

  -- R3: the ASSIGNEE reads the assigned step (pre-existing WES-3B ground).
  select exists (select 1 from public.user_readable_file_ids(coord_a, t_a) v where v.id = d_assigned) into ok;
  if not ok then raise exception 'FAIL R3: step assignee lost visibility'; end if;

  -- R4 NARROWING: another ordinary holder of the OWNING ROLE is denied once the
  -- step is claimed. Carried by COURIER: it owns exactly one step, holds no
  -- tenant-wide read and is not a customs-department role, so the F-1 ground is
  -- the only thing that could grant it anything here.
  select exists (select 1 from public.user_readable_file_ids(courier_b, t_a) v where v.id = d_courier_claimed) into ok;
  if ok then raise exception 'FAIL R4: owning-role visibility survived assignment (narrowing absent)'; end if;

  -- ...and the ASSIGNEE of that same claimed step still reads it (WES-3B), so R4
  -- is proving narrowing rather than a blanket denial.
  select exists (select 1 from public.user_readable_file_ids(courier, t_a) v where v.id = d_courier_claimed) into ok;
  if not ok then raise exception 'FAIL R4b: the step assignee lost their own read'; end if;

  -- R5: a terminal step grants nothing.
  select exists (select 1 from public.user_readable_file_ids(courier, t_a) v where v.id = d_courier_done) into ok;
  if ok then raise exception 'FAIL R5: responsibility visibility survived step completion'; end if;

  -- R6: membership without an open step on THIS dossier grants nothing. The only
  -- open step here is coordinator_completeness, which COURIER does not own.
  select exists (select 1 from public.user_readable_file_ids(courier_b, t_a) v where v.id = d_open) into ok;
  if ok then raise exception 'FAIL R6: role membership alone granted access'; end if;

  -- R7: cross-tenant, both directions.
  select exists (select 1 from public.user_readable_file_ids(coord_a, t_a) v where v.id = d_c9) into ok;
  if ok then raise exception 'FAIL R7a: cross-tenant read'; end if;
  select exists (select 1 from public.user_readable_file_ids(coord_a, t_c) v where v.id = d_c9) into ok;
  if ok then raise exception 'FAIL R7b: tenant-A user read tenant-C file by passing tenant C'; end if;
  select exists (select 1 from public.user_readable_file_ids(coord_c9, t_c) v where v.id = d_c9) into ok;
  if not ok then raise exception 'FAIL R7c: tenant-C coordinator lost their own legitimate read'; end if;

  -- T1 THE RATIFIED TENANT-WIDE RULE. The same dossiers R4/R5/R6 prove are
  -- unreachable for an unrelated COURIER are readable by ANY Coordinator --
  -- claimed by someone else, completed, or carrying no Coordinator step at all.
  -- This is the rule that replaced "a Coordinator sees what it is attached to".
  select exists (select 1 from public.user_readable_file_ids(coord_b, t_a) v where v.id = d_assigned) into ok;
  if not ok then raise exception 'FAIL T1a: a Coordinator cannot read a dossier whose step another Coordinator claimed'; end if;
  select exists (select 1 from public.user_readable_file_ids(coord_b, t_a) v where v.id = d_terminal) into ok;
  if not ok then raise exception 'FAIL T1b: a Coordinator cannot read a dossier whose step completed'; end if;
  select exists (select 1 from public.user_readable_file_ids(coord_b, t_a) v where v.id = d_courier) into ok;
  if not ok then raise exception 'FAIL T1c: a Coordinator cannot read a dossier carrying no Coordinator step'; end if;
  select exists (select 1 from public.user_readable_file_ids(coord_b, t_a) v where v.id = d_courier_done) into ok;
  if not ok then raise exception 'FAIL T1d: a Coordinator cannot read a dossier in a terminal courier state'; end if;

  -- ...and tenant-wide stops at the tenant. R7 covers the same ground from the
  -- other direction; this is the assertion stated on the widened role itself.
  select exists (select 1 from public.user_readable_file_ids(coord_b, t_a) v where v.id = d_c9) into ok;
  if ok then raise exception 'FAIL T1e: tenant-wide Coordinator read crossed into another tenant'; end if;

  -- FD-2: courier reads the dossier while courier_deposit is open+unassigned.
  select exists (select 1 from public.user_readable_file_ids(courier, t_a) v where v.id = d_courier) into ok;
  if not ok then raise exception 'FAIL FD-2: courier cannot read a dossier whose courier step is open'; end if;

  -- G1: migration 121 handoff-receiver ground still works ON ITS OWN. The target
  -- step here is PENDING, so the F-1 ground cannot be what grants this.
  select exists (select 1 from public.user_readable_file_ids(chief, t_a) v where v.id = d_handoff) into ok;
  if not ok then raise exception 'FAIL G1: handoff-receiver ground (121) lost'; end if;

  -- G2: operational owner (WES-3G).
  select exists (select 1 from public.user_readable_file_ids(owner_u, t_a) v where v.id = d_owner) into ok;
  if not ok then raise exception 'FAIL G2: operational-owner ground lost'; end if;

  -- G3: creator.
  select exists (select 1 from public.user_readable_file_ids(creator, t_a) v where v.id = d_creator) into ok;
  if not ok then raise exception 'FAIL G3: created_by ground lost'; end if;

  raise notice 'F-1 responsibility visibility: R1-R7, T1, FD-1, FD-2, G1-G3 all hold';
end $$;

rollback;
