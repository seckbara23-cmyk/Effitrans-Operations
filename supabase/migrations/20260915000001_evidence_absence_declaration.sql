-- ===========================================================================
-- C-3 — AUDITED DECLARED ABSENCE of evidence (ratified 2026-08-24)
-- ===========================================================================
-- THE DEFECT. Step 3's completion evidence — TRANSPORT_REQUEST,
-- BORDEREAU_LIVRAISON, VENDOR_INVOICE, SPENDING_AUTHORIZATION — is enforced
-- unconditionally, but three of those four exist only when the dossier actually
-- has that thing: a third-party payable, an advance expense, an Effitrans-run
-- transport. A legitimate dossier without them could NEVER complete step 3, and
-- because step 3 gates the Transit handoff the whole journey stopped there.
--
-- THE MECHANISM. Not an exception and not a skip: a DECLARATION. The responsible
-- actor states, on the record, that a specific evidence type does not apply to
-- this dossier and why. It is the same idiom the platform already ratified for
-- cotation (« Sans devis » — a derived, audited reason), generalised to evidence.
--
-- RATIFIED SCOPE (2026-08-24) — declarable:
--     VENDOR_INVOICE, SPENDING_AUTHORIZATION, TRANSPORT_REQUEST
--   NOT declarable, ever:
--     BORDEREAU_LIVRAISON, and step 18's RECEIPT / PAYMENT_PROOF
--   The declarable list is enforced in application code (lib/process/evidence-
--   absence.ts) AND pinned here by CHECK, so a row for a non-declarable type
--   cannot exist even if a future caller forgets.
--
-- WHAT IT IS NOT:
--   • it fabricates NO document row — nothing downstream can mistake a
--     declaration for a real piece of paper;
--   • it satisfies ONLY the one evidence key it names, on ONE dossier;
--   • it never makes evidence optional in general — the type must be declarable
--     and the reason must be non-empty;
--   • it is visible to every later reviewer (readable to anyone who may read the
--     dossier) precisely so a completeness check can see what was waived.
-- ===========================================================================

create table if not exists public.evidence_absence_declaration (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization(tenant_id) on delete cascade,
  file_id      uuid not null references public.operational_file(id) on delete cascade,
  evidence_key text not null,
  reason       text not null,
  declared_by  uuid not null references public.app_user(id),
  declared_at  timestamptz not null default now(),
  -- Only the ratified set. A future caller cannot widen this by accident.
  constraint evidence_absence_declarable check (
    evidence_key in ('VENDOR_INVOICE', 'SPENDING_AUTHORIZATION', 'TRANSPORT_REQUEST')
  ),
  -- A reason is mandatory and must say something.
  constraint evidence_absence_reason_not_blank check (length(btrim(reason)) > 0)
);

-- One live declaration per (dossier, evidence type).
create unique index if not exists uq_evidence_absence_file_key
  on public.evidence_absence_declaration (file_id, evidence_key);

create index if not exists ix_evidence_absence_tenant_file
  on public.evidence_absence_declaration (tenant_id, file_id);

comment on table public.evidence_absence_declaration is
  'C-3: an audited declaration that a specific evidence type does not apply to a specific dossier. Satisfies that one requirement only; fabricates no document; declarable types are constrained to the ratified set.';

alter table public.evidence_absence_declaration enable row level security;

-- READ: anyone who may read the dossier may see what was waived on it. A waiver
-- that reviewers cannot see would be worse than no waiver at all.
drop policy if exists evidence_absence_select on public.evidence_absence_declaration;
create policy evidence_absence_select on public.evidence_absence_declaration
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.can_read_file(file_id));

-- WRITE: through the server action only (service role). No client-side insert
-- path exists, so the action's permission + step gate is the single boundary.
grant select on public.evidence_absence_declaration to authenticated;
grant select, insert, delete on public.evidence_absence_declaration to service_role;

-- ------------------------------------------------------- self-assertions ----
do $$
declare
  v_ok boolean;
begin
  if to_regclass('public.evidence_absence_declaration') is null then
    raise exception 'MIGRATION FAILED: evidence_absence_declaration not created';
  end if;

  -- The declarable CHECK must actually refuse a non-declarable type.
  begin
    insert into public.evidence_absence_declaration (tenant_id, file_id, evidence_key, reason, declared_by)
    values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'BORDEREAU_LIVRAISON', 'should be refused',
      '00000000-0000-0000-0000-000000000000'
    );
    raise exception 'MIGRATION FAILED: a non-declarable evidence type was accepted';
  exception
    when check_violation then null;                 -- the constraint did its job
    when foreign_key_violation then null;           -- refused earlier, also fine
    when others then
      if sqlerrm like '%evidence_absence_declarable%' then null; else raise; end if;
  end;

  -- A blank reason must be refused.
  begin
    insert into public.evidence_absence_declaration (tenant_id, file_id, evidence_key, reason, declared_by)
    values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'VENDOR_INVOICE', '   ',
      '00000000-0000-0000-0000-000000000000'
    );
    raise exception 'MIGRATION FAILED: a blank reason was accepted';
  exception
    when check_violation then null;
    when foreign_key_violation then null;
    when others then
      if sqlerrm like '%reason_not_blank%' then null; else raise; end if;
  end;

  select exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'evidence_absence_declaration'
      and policyname = 'evidence_absence_select'
  ) into v_ok;
  if not v_ok then
    raise exception 'MIGRATION FAILED: read policy missing — waivers must be visible to reviewers';
  end if;

  raise notice 'evidence absence declaration installed';
end $$;
