-- ===========================================================================
-- REPAIR: a customer representative mis-provisioned as a STAFF app_user
-- ===========================================================================
--
-- PRODUCTION DEFECT THIS REPAIRS
--
-- adja.gueye@caetano.sn (and potentially others created the same way) was created
-- through the INTERNAL /users screen (lib/users/actions.ts createUser()) with the
-- 'CLIENT_USER' role, instead of through the customer portal invite flow
-- (lib/portal/admin-actions.ts invitePortalUser / createPortalAccess). That put her
-- in public.app_user + public.user_role(role.code = 'CLIENT_USER') — a STAFF identity
-- carrying zero real permissions (the CLIENT_USER role template is baseline-only) —
-- instead of public.client_user, the portal identity table.
--
-- Because lib/auth/session-class.ts classifySession() resolves identity from TABLE
-- MEMBERSHIP (does an app_user row exist?), not role content, she was classified
-- "staff" and every login/refresh landed her on /dashboard — the internal "Centre
-- d'opérations" shell — never the Customer Portal. RLS itself was never at risk: with
-- no client_user row, every portal-scoped policy (portal_can_read_shipment, etc.)
-- correctly returned nothing for her — she was stranded, not exposed.
--
-- THE FORWARD-LOOKING CODE FIX (same change set as this script) closes the hole:
--   - lib/users/service.ts listAssignableRoles() no longer offers CLIENT_USER;
--   - lib/users/actions.ts createUser()/assignRole() reject it even if a caller
--     bypasses the UI, and createUser() now also rejects creating a staff account
--     for an email that already exists in client_user (the reciprocal of the
--     existing "email_is_staff" guard on the portal invite side);
--   - lib/auth/current-user.ts getSessionClass() (and the equivalent inline lookup
--     in lib/supabase/middleware.ts) now requires app_user.status = 'active' — an
--     ARCHIVED app_user row (what step 5 below produces) can no longer shadow a
--     real, active client_user and force "staff" classification.
-- This script repairs the ALREADY-CREATED account; the code fix stops new ones.
--
-- WHAT THIS SCRIPT DOES
--   1. Locates the existing auth.users row by email. NEVER creates one.
--   2. ABORTS if she holds any REAL operational role alongside CLIENT_USER — this
--      script repairs exactly the CLIENT_USER-only mis-provisioning; a genuine
--      dual-role account needs a human decision, not an automated script.
--   3. Locates the ONE client company matching a name pattern you supply. ABORTS on
--      zero or on more than one match — it will not guess which company she reps.
--   4. Creates (or reactivates) her client_user row, ACTIVE, pointed at that client.
--      Her existing password keeps working (same auth.users row, same credentials);
--      must_change_password is left false — she is not on a temporary password, so
--      there is nothing to force a change for.
--   5. Removes the incorrect employee relationship: deletes the CLIENT_USER
--      user_role row, then ARCHIVES (never deletes) the app_user row — the SAME
--      lifecycle state Phase 8.1A uses for employee departure, so nothing that may
--      reference app_user.id (audit_log.actor_id, etc.) is broken by a delete, and
--      the mistake stays inspectable instead of disappearing. Her auth.users row
--      (login credentials) is never touched or banned — she must still be able to
--      sign in, now as a portal customer.
--   6. Writes ONE audit_log entry recording the before/after of the repair.
--
-- IDEMPOTENT. Re-running after a successful repair changes nothing further: the
-- client_user insert is ON CONFLICT (id) DO UPDATE, and the user_role delete /
-- app_user archive are no-ops once already applied.
--
-- HOW TO RUN
--   1. Confirm the correct client company in the app first (Clients screen) — do
--      not guess the ILIKE pattern below without checking it matches exactly ONE
--      active client.
--   2. Supabase Dashboard -> SQL Editor -> paste this file.
--   3. Edit the two lines marked EDIT THIS below. Nothing else.
--   4. Run. Read the NOTICEs and the final verification SELECT before telling
--      anyone the account is fixed.
--
-- NO psql BACKSLASH COMMANDS. The Supabase SQL editor is not psql.
-- ===========================================================================

begin;

do $$
declare
  -- EDIT THESE TWO LINES
  target_email        constant text := 'adja.gueye@caetano.sn';
  target_client_like  constant text := '%Caetano%';
  -- EDIT THESE TWO LINES (above)

  auth_id           uuid;
  auth_email        text;
  derived_name      text;
  au_id             uuid;
  au_tenant_id      uuid;
  au_status         text;
  au_name           text;
  extra_roles       text[];
  client_count      int;
  client_id         uuid;
  client_tenant_id  uuid;
  client_name       text;
  cu_existed        boolean;
  cu_status_before  text;
  cu_client_before  uuid;
begin
  -- (1) LOCATE the auth user. Never create one.
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
    into auth_id, auth_email, derived_name
  from auth.users u
  where lower(u.email) = lower(target_email);

  if auth_id is null then
    raise exception 'REPAIR FAILED: no auth.users row for %. Nothing to repair.', target_email;
  end if;

  -- (2) INSPECT her current staff identity, if any, and REFUSE to touch anything
  -- more than the exact mis-provisioning this script understands.
  select au.id, au.tenant_id, au.status, au.name
    into au_id, au_tenant_id, au_status, au_name
  from public.app_user au
  where au.id = auth_id;

  if au_id is not null then
    select array_agg(r.code order by r.code)
      into extra_roles
    from public.user_role ur
    join public.role r on r.id = ur.role_id
    where ur.user_id = auth_id
      and r.code <> 'CLIENT_USER';

    if extra_roles is not null and array_length(extra_roles, 1) > 0 then
      raise exception
        'REPAIR ABORTED: % holds REAL staff role(s) (%) in addition to (or instead of) CLIENT_USER. This is not the simple mis-provisioning this script repairs — resolve manually.',
        auth_email, array_to_string(extra_roles, ', ');
    end if;
  end if;

  -- (3) LOCATE the ONE matching client company. Refuse to guess.
  select count(*)
    into client_count
  from public.client c
  where c.name ilike target_client_like
    and c.status = 'active'
    and (au_tenant_id is null or c.tenant_id = au_tenant_id);

  if client_count = 0 then
    raise exception 'REPAIR ABORTED: no active client matches % — check the pattern against the Clients screen.', target_client_like;
  elsif client_count > 1 then
    raise exception 'REPAIR ABORTED: % matches more than one client — narrow target_client_like.', target_client_like;
  end if;

  select c.id, c.tenant_id, c.name
    into client_id, client_tenant_id, client_name
  from public.client c
  where c.name ilike target_client_like
    and c.status = 'active'
    and (au_tenant_id is null or c.tenant_id = au_tenant_id);

  -- Snapshot the client_user row BEFORE the repair (for the audit entry / idempotency).
  select true, cu.status, cu.client_id
    into cu_existed, cu_status_before, cu_client_before
  from public.client_user cu
  where cu.id = auth_id;
  cu_existed := coalesce(cu_existed, false);

  -- (4) CREATE or REACTIVATE the portal identity. Idempotent on the PK (auth id).
  insert into public.client_user (
    id, tenant_id, client_id, email, name, role, status, must_change_password, invited_by
  ) values (
    auth_id, client_tenant_id, client_id, auth_email,
    coalesce(au_name, derived_name), 'CLIENT_USER', 'ACTIVE', false, null
  )
  on conflict (id) do update
    set client_id = excluded.client_id,
        status    = 'ACTIVE',
        updated_at = now();

  -- (5) REMOVE the incorrect employee relationship. Delete ONLY the CLIENT_USER
  -- user_role row (step 2 already proved no other role is held), then archive —
  -- never delete — the app_user row. auth.users is never touched: she must still
  -- be able to sign in.
  if au_id is not null then
    delete from public.user_role ur
    using public.role r
    where ur.role_id = r.id
      and ur.user_id = auth_id
      and r.tenant_id = au_tenant_id
      and r.code = 'CLIENT_USER';

    update public.app_user
      set status = 'archived'
      where id = auth_id
        and status <> 'archived';
  end if;

  -- (6) AUDIT. system.-prefixed action: an operator-run repair, not an app_user-
  -- attributed request (AUD-2's rule for unattributed system events).
  insert into public.audit_log (action, tenant_id, client_user_id, entity, entity_id, before, after)
  values (
    'system.identity.customer_portal_repaired',
    client_tenant_id,
    auth_id,
    'client_user',
    auth_id,
    jsonb_build_object(
      'had_app_user', au_id is not null,
      'app_user_status_before', au_status,
      'had_client_user', cu_existed,
      'client_user_status_before', cu_status_before,
      'client_user_client_id_before', cu_client_before
    ),
    jsonb_build_object(
      'client_user_status', 'ACTIVE',
      'client_user_client_id', client_id,
      'client_id_name', client_name,
      'app_user_archived', au_id is not null,
      'via', 'repair_customer_identity_mis_provisioned.sql'
    )
  );

  raise notice 'REPAIRED: % (%) -> client_user ACTIVE @ client "%s" (id %). app_user %.',
    auth_email, auth_id, client_name, client_id,
    case when au_id is not null then 'archived' else '(none existed)' end;
end $$;

commit;

-- ===========================================================================
-- VERIFY — read the account back. Confirm before telling anyone it is fixed.
-- ===========================================================================
select
  u.email,
  u.id                                    as auth_user_id,
  u.banned_until,                                              -- must be NULL: login must still work
  au.status                               as app_user_status,  -- expect 'archived' or NULL
  coalesce(
    (select string_agg(r.code, ', ' order by r.code)
     from public.user_role ur join public.role r on r.id = ur.role_id
     where ur.user_id = u.id),
    '(none)'
  )                                        as remaining_staff_roles,   -- expect '(none)'
  cu.status                               as client_user_status,      -- expect 'ACTIVE'
  c.name                                  as client_user_company,     -- expect the correct company
  cu.role                                 as client_user_role,
  cu.must_change_password
from auth.users u
left join public.app_user au    on au.id = u.id
left join public.client_user cu on cu.id = u.id
left join public.client c       on c.id = cu.client_id
where lower(u.email) = lower('adja.gueye@caetano.sn');

-- Expected result:
--   banned_until               = NULL           (she can still authenticate)
--   app_user_status            = 'archived'      (the incorrect staff record, kept for history)
--   remaining_staff_roles      = '(none)'         (the CLIENT_USER role grant is gone)
--   client_user_status         = 'ACTIVE'
--   client_user_company        = the Caetano client row
--   client_user_role           = 'CLIENT_USER'
--   must_change_password       = false
--
-- NEXT: sign in as adja.gueye@caetano.sn with her existing password. getSessionClass
-- now sees no ACTIVE app_user and one ACTIVE client_user -> classifySession returns
-- "portal" -> she lands on /portal.
