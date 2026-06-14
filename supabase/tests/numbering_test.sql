-- Numbering test — next_file_number (Phase 1.2, DEC-B06). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves EFT-{TYPE}-{YEAR}-{SEQUENCE}: 5-digit zero-padded sequence that
-- increments per tenant x type x year, with separate sequences per type and
-- per tenant. Assumes a FRESH file_counter (CI `db reset`) — do NOT run against
-- a production tenant that already has files (the counter would not start at 1).

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  n1 text; n2 text; n3 text; e1 text; b1 text;
begin
  n1 := public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP');
  n2 := public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP');
  n3 := public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP');
  e1 := public.next_file_number('00000000-0000-0000-0000-000000000001', 'EXP');  -- separate type seq
  b1 := public.next_file_number('00000000-0000-0000-0000-0000000000b2', 'IMP');  -- separate tenant seq

  insert into _r values
    ('imp_1', n1), ('imp_2', n2), ('imp_3', n3), ('exp_1', e1), ('tenantB_imp_1', b1);

  if right(n1, 5) <> '00001' or right(n2, 5) <> '00002' or right(n3, 5) <> '00003'
     or right(e1, 5) <> '00001' or right(b1, 5) <> '00001'
     or n1 not like 'EFT-IMP-%' or e1 not like 'EFT-EXP-%' then
    raise exception 'NUMBERING FAIL: imp=%/%/%, exp=%, tenantB=% (expected seq 1/2/3, exp 1, tenantB 1)',
      n1, n2, n3, e1, b1;
  end if;
end $$;

select * from _r order by check_name;
rollback;
