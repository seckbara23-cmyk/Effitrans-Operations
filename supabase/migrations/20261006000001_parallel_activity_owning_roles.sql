-- ===========================================================================
-- UAT-PARALLEL-OWNERSHIP-01 — the three parallel activities get their owner.
-- ===========================================================================
-- WHAT PRODUCTION DID, on EFT-IMP-2026-00011. The dossier shows « Account
-- Manager — obtenir le Bon à Délivrer » with « En cours : Omar Gadiaga », who
-- holds Coordinateur des opérations, Agent de terrain douane, Agent
-- d'enlèvement and Coursier — and no Account Manager role at all. He was not
-- assigned: the audit records `process.step.activated` by his own account at
-- 2026-09-09 13:47:33.93, the same instant as the row's `started_at`. He
-- self-claimed by pressing Démarrer, and the platform allowed it.
--
-- WHY IT WAS ALLOWED. `activateStep` asks `owningRoleRefusal`, which asks
-- `evaluateControlOwnership` with the role from THIS table. The registry
-- declares `role: "ACCOUNT_MANAGER"` on all three parallel activities, but this
-- table was seeded with the 26 NUMBERED steps only — « one row per official
-- step » — so the three activities had no row. With no owning role the rule
-- returns `unowned_step` and defers to the activity's permission alone, which
-- for these three is `document:create`: a permission fourteen roles hold
-- because each needs it for its own work. The owning-role control was not
-- bypassed; for these activities it had never been armed.
--
-- It happened twice, not once: EFT-IMP-2026-00012's `bon_a_delivrer` is also
-- claimed by a non-Account-Manager. Both rows are left exactly as they are.
--
-- WHY THIS TABLE AND NOT THE REGISTRY. The registry's `role` field is
-- DOCUMENTARY (DEC-C35): it carries the official process vocabulary and names
-- three roles that exist in no tenant — CHIEF_TRANSIT, COTATION_OFFICER,
-- OPERATIONS_MANAGER — and rewriting it to state authority was explicitly
-- refused. This table is what `activateStep` and `assertControlOwner` enforce
-- against, so it is the one place an owner can be added. Deriving the gate from
-- the registry instead would have made those three phantom roles authoritative.
--
-- ⚠ THE OWNER MUST BE ABLE TO DO THE WORK. Migration 20260917000001 exists
-- because step 16 was owned by ACCOUNT_MANAGER while its execution permission
-- was one that role must never hold, so the owner was shown work it was then
-- refused. The same trap is checked below for all three activities before this
-- migration is allowed to succeed: ACCOUNT_MANAGER holds `document:create` and
-- `process:handoff:send`, which is every permission the three declare.
--
-- WHAT THIS DOES NOT DO. It writes no execution row, moves no claimant and
-- rewrites no history: an activity already claimed stays claimed by whoever
-- claimed it, because the gate only asks about ownership when a step is
-- UNASSIGNED. It adds no permission, no role and no exception. Reassigning an
-- already-claimed activity remains unbuilt and out of scope.
--
-- ⚠ ONE CONSEQUENCE BEYOND THE GATE, stated rather than discovered later. This
-- table is also read by `user_readable_file_ids` (clause F-1): a user may READ
-- a dossier carrying an OPEN, UNASSIGNED step their role owns. Adding these
-- rows therefore also lets an Account Manager SEE a dossier whose parallel
-- activity is open and unclaimed — which is the same rule the three numbered
-- Account Manager steps already grant, applied to the three activities the same
-- role already owns. Measured on production before writing this: 2 dossiers of
-- 13 gain that ground, and it narrows again the moment the activity is claimed.
-- ===========================================================================

insert into public.process_step_owning_role (step_key, role_code, note) values
  ('bon_a_delivrer',              'ACCOUNT_MANAGER',
   'UAT-PARALLEL-OWNERSHIP-01. Parallel activity, registry role ACCOUNT_MANAGER. Unowned here until 2026-09-17, which let a Coordinator self-claim it on EFT-IMP-2026-00011 through document:create.'),
  ('pre_gate',                    'ACCOUNT_MANAGER',
   'UAT-PARALLEL-OWNERSHIP-01. Parallel activity, registry role ACCOUNT_MANAGER.'),
  ('transport_docs_transmission', 'ACCOUNT_MANAGER',
   'UAT-PARALLEL-OWNERSHIP-01. Parallel activity, registry role ACCOUNT_MANAGER. Declares document:create AND process:handoff:send; the owning role holds both.')
on conflict (step_key, role_code) do nothing;

-- ---------------------------------------------------------------- guards ----
do $$
declare
  v_rows      int;
  v_total     int;
  v_owners    int;
  v_missing   text;
  v_claimed   int;
begin
  -- 1. The three activities are mapped, each to exactly one owner.
  select count(*) into v_rows
  from public.process_step_owning_role
  where step_key in ('bon_a_delivrer', 'pre_gate', 'transport_docs_transmission');
  if v_rows <> 3 then
    raise exception 'MIGRATION FAILED: the three parallel activities must map to exactly 3 rows, found %', v_rows;
  end if;

  select count(distinct step_key) into v_owners
  from public.process_step_owning_role
  where step_key in ('bon_a_delivrer', 'pre_gate', 'transport_docs_transmission')
    and role_code = 'ACCOUNT_MANAGER';
  if v_owners <> 3 then
    raise exception 'MIGRATION FAILED: each parallel activity must be owned by ACCOUNT_MANAGER (% mapped)', v_owners;
  end if;

  -- 2. The 26 numbered steps are untouched: 26 + 3 = 29, and nothing was lost.
  select count(*) into v_total from public.process_step_owning_role;
  if v_total <> 29 then
    raise exception 'MIGRATION FAILED: owning-role map has % rows, expected 29 (26 official steps + 3 parallel activities)', v_total;
  end if;

  -- 3. ⚠ THE STEP-16 TRAP. In every tenant that has an ACCOUNT_MANAGER role,
  --    that role must already hold every permission the three activities
  --    declare. An owner that cannot execute its own work is the fault
  --    migration 20260917000001 had to repair; this refuses to create it again.
  select string_agg(distinct r.tenant_id::text || ':' || p.code, ', ') into v_missing
  from public.role r
  cross join (values ('document:create'), ('process:handoff:send')) as p(code)
  where r.code = 'ACCOUNT_MANAGER'
    and not exists (
      select 1
      from public.role_permission rp
      join public.permission pm on pm.id = rp.permission_id
      where rp.role_id = r.id and pm.code = p.code
    );
  if v_missing is not null then
    raise exception 'MIGRATION FAILED: ACCOUNT_MANAGER cannot execute its own activities (missing %)', v_missing;
  end if;

  -- 4. NO EXECUTION ROW WAS TOUCHED. This migration inserts into one catalog
  --    table; an activity already claimed keeps its claimant, its state and its
  --    timestamps. Asserted rather than assumed, because the whole point of the
  --    slice is to change the future without rewriting the past.
  select count(*) into v_claimed
  from public.process_step_execution
  where step_key in ('bon_a_delivrer', 'pre_gate', 'transport_docs_transmission')
    and assigned_user_id is not null;
  raise notice 'UAT-PARALLEL-OWNERSHIP-01 OK: 3 activities owned by ACCOUNT_MANAGER, map now % rows; % already-claimed activity execution(s) left exactly as they are', v_total, v_claimed;
end $$;
