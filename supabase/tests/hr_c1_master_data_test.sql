-- ===========================================================================
-- HR-C1 — master-data corrections: the hierarchy cannot be corrupted by UPDATE.
-- ---------------------------------------------------------------------------
-- The org-unit parent trigger has guarded INSERTs since HR-1B. HR-C1 introduces
-- the first UPDATE path (updateOrgUnit re-parents), so this suite proves the
-- trigger holds on UPDATE too, live:
--
--   * self-parent ................................ refused
--   * descendant as parent (the cycle case) ...... refused, BY THE RANK RULE
--   * same/higher rank parent .................... refused
--   * cross-tenant parent ........................ refused
--   * valid re-parent ............................ accepted
--
-- And one HONEST negative: the DATABASE ALLOWS a kind change that breaks the
-- unit's own children (the trigger never looks down). That is exactly why
-- updateOrgUnit checks child compatibility BEFORE writing — the action is the
-- boundary, as HR-A2 established for assignments. This suite records the
-- database's actual behaviour so the app-side check can never be deleted on
-- the belief that "the trigger handles it".
--
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

-- ---- fixtures -------------------------------------------------------------
insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000d1001', 'HR-C1 Tenant A', 'SN'),
  ('00000000-0000-0000-0000-0000000d1002', 'HR-C1 Tenant B', 'SN')
on conflict (id) do nothing;

-- Tenant A: BU -> DEPT -> SECTION, plus a second BU to re-parent under.
insert into public.hr_org_unit (id, tenant_id, unit_kind, name) values
  ('00000000-0000-0000-0000-0000000d1b01', '00000000-0000-0000-0000-0000000d1001', 'BUSINESS_UNIT', 'Direction A'),
  ('00000000-0000-0000-0000-0000000d1b02', '00000000-0000-0000-0000-0000000d1001', 'BUSINESS_UNIT', 'Direction B')
on conflict (id) do nothing;
insert into public.hr_org_unit (id, tenant_id, unit_kind, name, parent_id) values
  ('00000000-0000-0000-0000-0000000d1d01', '00000000-0000-0000-0000-0000000d1001', 'DEPARTMENT', 'Departement X', '00000000-0000-0000-0000-0000000d1b01')
on conflict (id) do nothing;
insert into public.hr_org_unit (id, tenant_id, unit_kind, name, parent_id) values
  ('00000000-0000-0000-0000-0000000d1f01', '00000000-0000-0000-0000-0000000d1001', 'SECTION', 'Section Y', '00000000-0000-0000-0000-0000000d1d01')
on conflict (id) do nothing;

-- Tenant B: a foreign BU for the cross-tenant case.
insert into public.hr_org_unit (id, tenant_id, unit_kind, name) values
  ('00000000-0000-0000-0000-0000000d2b01', '00000000-0000-0000-0000-0000000d1002', 'BUSINESS_UNIT', 'Direction etrangere')
on conflict (id) do nothing;

-- ---- 1. self-parent is refused on UPDATE ----------------------------------
do $$
begin
  begin
    update public.hr_org_unit set parent_id = id
     where id = '00000000-0000-0000-0000-0000000d1d01';
    raise exception 'HR-C1: self-parent must be refused';
  exception when others then
    if sqlerrm like 'HR-C1:%' then raise; end if;
  end;
end $$;

-- ---- 2. a DESCENDANT as parent is refused — the cycle case ----------------
do $$
begin
  -- Departement X under its own Section Y: rank(SECTION) >= rank(DEPARTMENT),
  -- so the strict order refuses it. This is the structural cycle proof: every
  -- legal ancestor has a strictly LOWER rank, so no unit can ever appear in
  -- its own ancestry.
  begin
    update public.hr_org_unit set parent_id = '00000000-0000-0000-0000-0000000d1f01'
     where id = '00000000-0000-0000-0000-0000000d1d01';
    raise exception 'HR-C1: a descendant must never be accepted as parent';
  exception when others then
    if sqlerrm like 'HR-C1:%' then raise; end if;
  end;
end $$;

-- ---- 3. same-rank parent is refused ---------------------------------------
do $$
begin
  begin
    update public.hr_org_unit set parent_id = '00000000-0000-0000-0000-0000000d1b02'
     where id = '00000000-0000-0000-0000-0000000d1b01';
    raise exception 'HR-C1: a same-rank parent must be refused';
  exception when others then
    if sqlerrm like 'HR-C1:%' then raise; end if;
  end;
end $$;

-- ---- 4. cross-tenant parent is refused ------------------------------------
do $$
begin
  begin
    update public.hr_org_unit set parent_id = '00000000-0000-0000-0000-0000000d2b01'
     where id = '00000000-0000-0000-0000-0000000d1d01';
    raise exception 'HR-C1: a cross-tenant parent must be refused';
  exception when others then
    if sqlerrm like 'HR-C1:%' then raise; end if;
  end;
end $$;

-- ---- 5. a valid re-parent is accepted -------------------------------------
do $$
declare v_parent uuid;
begin
  update public.hr_org_unit set parent_id = '00000000-0000-0000-0000-0000000d1b02'
   where id = '00000000-0000-0000-0000-0000000d1d01';
  select parent_id into v_parent from public.hr_org_unit
   where id = '00000000-0000-0000-0000-0000000d1d01';
  if v_parent <> '00000000-0000-0000-0000-0000000d1b02' then
    raise exception 'HR-C1: the valid re-parent must persist';
  end if;
end $$;

-- ---- 6. THE HONEST NEGATIVE: the DB allows a child-breaking kind change ---
do $$
declare v_kind text;
begin
  -- Departement X still carries Section Y. Retyping it TEAM would strand the
  -- child — and the DATABASE ACCEPTS IT, because the trigger validates the
  -- changed row against its PARENT only. If this ever starts failing, the
  -- database gained a downward check and updateOrgUnit's app-side guard can be
  -- revisited; until then, deleting that guard reopens tree corruption.
  update public.hr_org_unit set unit_kind = 'TEAM'
   where id = '00000000-0000-0000-0000-0000000d1d01';
  select unit_kind into v_kind from public.hr_org_unit
   where id = '00000000-0000-0000-0000-0000000d1d01';
  if v_kind <> 'TEAM' then
    raise exception 'HR-C1: expected the DB to ACCEPT the kind change (the action is the boundary)';
  end if;
end $$;

rollback;
