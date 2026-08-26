-- ===========================================================================
-- Migration 127 — Recouvrement performs the final dossier closure.
-- BUSINESS-RATIFIED 2026-08-26 (C-4). Amends the MAYA-P1.5 grant pin.
-- ===========================================================================
-- The collections queue is described as « Échéances, relances et clôture APRÈS
-- paiement intégral », and Recouvrement is the department that works a dossier
-- to settlement. But `closeDossier` requires `process:close`, held only by
-- SYSTEM_ADMIN and OPS_SUPERVISOR — so the last act of every dossier was a
-- supervisory intervention, in a programme whose whole purpose is to prove the
-- workflow runs without one.
--
-- MAYA-P1.5 pinned that NEITHER end-stage role may hold `process:close`. That
-- guard was STRONGER than the requirement it defends. Effitrans has ruled
-- explicitly: Recouvrement closes. The amendment is recorded in
-- tests/maya-p15-archive-boundary.test.ts, in its rationale and in its
-- assertions — a ratification, not a workaround.
--
-- THE ENDURING SEPARATION IS UNCHANGED, and is asserted both there and here:
--   * Administration ARCHIVES and may not close (no process:close);
--   * Recouvrement CLOSES and may not archive (no admin_service:manage,
--     no courier:assign);
--   * archive and closure remain distinct acts, and no single end-stage role
--     may collapse both.
--
-- NO ABILITY TO CLOSE EARLY IS GRANTED, and that is the whole of its safety.
-- The permission decides who may ASK; the gates decide whether the answer is
-- yes, and none of them moves:
--   * closeDossier evaluates the authoritative closure gate first and refuses
--     with the COMPLETE blocker list — delivery, POD, invoice validated and
--     emailed, zero balance, no open dispute, collections complete, and, when
--     the client requires it, deposit proof accepted and handed to collections;
--   * the dossier's own transition re-checks its own guards besides: customs
--     released, invoice settled, and payment VERIFICATION — a zero balance
--     reached through unverified payments is not a settled dossier.
--
-- SYSTEM_ADMIN and OPS_SUPERVISOR keep their closure authority; nothing is
-- taken away. Mirrored in seed.sql and role-templates.ts.

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:close'
where r.code = 'COLLECTIONS_OFFICER'
on conflict do nothing;

do $$
declare
  v_roles    int;
  v_granted  int;
  v_keep     int;
  v_admin    int;
  v_archive  int;
begin
  select count(*) into v_roles from public.role where code = 'COLLECTIONS_OFFICER';

  select count(*) into v_granted
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'COLLECTIONS_OFFICER' and p.code = 'process:close';

  if v_granted <> v_roles then
    raise exception 'M127: expected % COLLECTIONS_OFFICER grants of process:close, got %', v_roles, v_granted;
  end if;

  -- Nothing was taken from the roles that could already close.
  select count(distinct r.code) into v_keep
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where p.code = 'process:close' and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR');

  if v_keep <> 2 then
    raise exception 'M127: SYSTEM_ADMIN/OPS_SUPERVISOR closure authority was disturbed (% of 2)', v_keep;
  end if;

  -- THE SEPARATION, both directions. Administration must not gain closure...
  select count(*) into v_admin
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'ADMINISTRATIVE_OFFICER' and p.code = 'process:close';

  if v_admin <> 0 then
    raise exception 'M127: ADMINISTRATIVE_OFFICER holds process:close — archive and closure would collapse into one role';
  end if;

  -- ...and Recouvrement must not gain Administration's archive acts.
  select count(*) into v_archive
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'COLLECTIONS_OFFICER'
    and p.code in ('admin_service:manage', 'courier:assign');

  if v_archive <> 0 then
    raise exception 'M127: COLLECTIONS_OFFICER holds % Administration capability(ies) — the separation is breached', v_archive;
  end if;

  raise notice 'M127 OK: closure granted to % Recouvrement role(s); supervisors unchanged; archive/closure separation intact', v_granted;
end $$;
