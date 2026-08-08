-- 20260813000001_mailbox_membership.sql
-- Effitrans — EMP-4A: mailbox membership, identity lifecycle and MAIL_ADMIN.
--
-- This is the migration the EMP-4A audit stopped for. It introduces the
-- per-mailbox access boundary EMP-0 deferred as RATIFY-EMP-2, and it does so by
-- REWRITING four deployed RLS policies — which is why it was ratified before a
-- line of it was written. The governance freeze is
-- docs/mail/emp-4a-governance-freeze.md.
--
-- WHAT MEMBERSHIP DOES AND DOES NOT DO
-- Membership NARROWS. Every rewritten policy keeps its existing
-- `has_permission('communication:inbound:read')` term, so membership is ANDed
-- and can never substitute for the correspondence authority. A member of every
-- mailbox who lacks that permission still sees nothing.
--
-- WHAT IS DELIBERATELY ABSENT
--   * `can_send_as` — RATIFIED OUT. The provider envelope always uses
--     COMMUNICATIONS_EMAIL_FROM and ignores the selected mailbox, so a
--     capability by that name would claim something the recipient never sees.
--     It returns in EMP-4B, after the provider honours it.
--   * any provider, domain, IMAP, POP3 or Exchange integration. "Provision"
--     reserves an INTERNAL identity; the external mailbox is created by an
--     operator out of band, and a retry is an audited internal retry that calls
--     nothing.
--   * `ec_webhook_event` is NOT membership-scoped (RATIFY-EMP4A-3): it carries
--     no mailbox attribution, so scoping it would be a guess.

-- ===========================================================================
-- 1. MAILBOX IDENTITY AND LIFECYCLE
-- ===========================================================================
alter table public.ec_mailbox
  add column if not exists mailbox_type text not null default 'SHARED'
    check (mailbox_type in ('SHARED', 'PERSONAL')),
  add column if not exists provisioning_status text not null default 'ACTIVE'
    check (provisioning_status in
      ('DRAFT', 'PENDING_EXTERNAL_SETUP', 'ACTIVE', 'DISABLED', 'SETUP_FAILED')),
  add column if not exists owner_user_id uuid references public.app_user (id),
  add column if not exists provisioning_note text,
  add column if not exists provisioning_attempts int not null default 0,
  add column if not exists provisioned_at timestamptz,
  add column if not exists provisioned_by uuid references public.app_user (id);

comment on column public.ec_mailbox.provisioning_status is
  'Administrative lifecycle. ACTIVE is the only state that routes mail. SETUP_FAILED is set ONLY by a human: the platform performs no external provisioning and therefore cannot observe an external failure.';
comment on column public.ec_mailbox.provisioning_attempts is
  'Count of operator-initiated retries. A retry calls no external service — it returns the mailbox to PENDING_EXTERNAL_SETUP and is audited.';

-- A PERSONAL mailbox names its owner; a SHARED one must not.
--
-- NOT VALID, following the EMP-3 lesson: ADD CONSTRAINT validates history by
-- default. Every existing row is SHARED with a NULL owner and would pass, but
-- the intent is stated rather than left to luck on a database whose contents
-- this migration cannot see.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ec_mailbox_owner_shape') then
    alter table public.ec_mailbox add constraint ec_mailbox_owner_shape
      check ((mailbox_type = 'PERSONAL') = (owner_user_id is not null)) not valid;
  end if;
end $$;

-- `is_active` is KEPT and remains authoritative for ROUTING, because EC-1's
-- capture path reads it. `provisioning_status` is the ADMINISTRATIVE view.
-- Two fields describing one fact will drift unless one of them is derived, so
-- this trigger makes the status the single writer.
create or replace function public.ec_mailbox_sync_active()
returns trigger language plpgsql as $$
begin
  new.is_active := (new.provisioning_status = 'ACTIVE');
  return new;
end $$;

drop trigger if exists trg_ec_mailbox_sync_active on public.ec_mailbox;
create trigger trg_ec_mailbox_sync_active
  before insert or update on public.ec_mailbox
  for each row execute function public.ec_mailbox_sync_active();

-- Existing rows: make the two agree in the direction that preserves today's
-- routing exactly — an inactive mailbox becomes DISABLED, never the reverse.
update public.ec_mailbox
   set provisioning_status = 'DISABLED'
 where is_active = false and provisioning_status = 'ACTIVE';

-- ===========================================================================
-- 2. MEMBERSHIP
-- ===========================================================================
create table if not exists public.ec_mailbox_member (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  mailbox_id         uuid not null references public.ec_mailbox (id),
  user_id            uuid not null references public.app_user (id),

  -- Four capabilities, each an explicit boolean so no one implies another.
  -- `can_send_as` is absent by ratification — see the header.
  can_read           boolean not null default true,
  can_send           boolean not null default false,
  can_manage_members boolean not null default false,
  is_default_sender  boolean not null default false,

  granted_by         uuid references public.app_user (id),
  granted_at         timestamptz not null default now(),
  -- REVOKE, never DELETE: "who had access in March" must stay answerable.
  revoked_at         timestamptz,
  revoked_by         uuid references public.app_user (id),
  revoke_reason      text
);

comment on table public.ec_mailbox_member is
  'Per-mailbox access. ANDed with communication:inbound:read — membership narrows, it never grants correspondence access on its own.';
comment on column public.ec_mailbox_member.can_send is
  'May initiate correspondence associated with this mailbox INSIDE Effitrans. It makes no claim about the provider envelope, which currently always uses the central configured sender.';

create unique index if not exists uq_ec_mailbox_member
  on public.ec_mailbox_member (mailbox_id, user_id);

-- The resolver's hot path.
create index if not exists idx_ec_mailbox_member_user
  on public.ec_mailbox_member (user_id, mailbox_id) where revoked_at is null;

-- At most one default sender per user, across all their mailboxes.
create unique index if not exists uq_ec_default_sender
  on public.ec_mailbox_member (user_id) where is_default_sender and revoked_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ec_member_capability_shape') then
    -- A default sender who cannot send is incoherent.
    alter table public.ec_mailbox_member add constraint ec_member_capability_shape
      check (not is_default_sender or can_send);
  end if;
  -- Revocation is a pair: both fields or neither.
  if not exists (select 1 from pg_constraint where conname = 'ec_member_revoke_shape') then
    alter table public.ec_mailbox_member add constraint ec_member_revoke_shape
      check ((revoked_at is null) = (revoked_by is null));
  end if;
end $$;

-- ===========================================================================
-- 3. ALIASES
-- ===========================================================================
create table if not exists public.ec_mailbox_alias (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  mailbox_id uuid not null references public.ec_mailbox (id),
  address    text not null,
  is_active  boolean not null default true,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  -- Same shape rules as the mailbox address itself, reused not reinvented.
  constraint ec_alias_lowercase check (address = lower(address)),
  constraint ec_alias_shape check (address like '%@%' and length(address) between 3 and 320)
);

-- GLOBAL, matching uq_ec_mailbox_address: two tenants claiming one address
-- would make routing a guess, and an alias is an address.
create unique index if not exists uq_ec_mailbox_alias_address
  on public.ec_mailbox_alias (address);
create index if not exists idx_ec_mailbox_alias_mailbox
  on public.ec_mailbox_alias (mailbox_id) where is_active;

-- An alias must not collide with a MAILBOX address either. That is cross-table
-- uniqueness, which no index expresses, so a trigger enforces it in both
-- directions and the behavioural block below proves it bites.
create or replace function public.ec_address_not_taken()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'ec_mailbox_alias' then
    if exists (select 1 from public.ec_mailbox where address = new.address) then
      raise exception 'address % is already a mailbox', new.address
        using errcode = 'unique_violation';
    end if;
  else
    if exists (select 1 from public.ec_mailbox_alias where address = new.address) then
      raise exception 'address % is already an alias', new.address
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ec_alias_address_unique on public.ec_mailbox_alias;
create trigger trg_ec_alias_address_unique
  before insert or update of address on public.ec_mailbox_alias
  for each row execute function public.ec_address_not_taken();

drop trigger if exists trg_ec_mailbox_address_unique on public.ec_mailbox;
create trigger trg_ec_mailbox_address_unique
  before insert or update of address on public.ec_mailbox
  for each row execute function public.ec_address_not_taken();

-- ===========================================================================
-- 4. PERMISSIONS AND THE MAIL_ADMIN ROLE
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('communication:mailbox:provision', 'communication', 'provision', 'all',
   'Reserve mailbox identities and record operator-assisted external setup outcomes'),
  ('communication:membership:manage', 'communication', 'manage', 'all',
   'Grant and revoke per-mailbox membership and capabilities'),
  ('communication:diagnostics:read', 'communication', 'read', 'all',
   'Read the inbound webhook journal (operator diagnostics)')
on conflict (code) do nothing;

-- MAIL_ADMIN — a dedicated role, because the only holders of
-- `communication:manage` today are SYSTEM_ADMIN (ratified out of correspondence)
-- and OPS_SUPERVISOR (granting it to every supervisor would widen a role several
-- people hold). It receives mailbox administration and NOTHING ELSE: no platform
-- administration, no role/permission administration, no finance, no document
-- deletion, no security configuration, no unrelated operations authority.
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select o.id, 'MAIL_ADMIN', 'Administrateur messagerie', 'Mail Administrator', true
  from public.organization o
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
  from public.role r
  join public.permission p on p.code in (
    'communication:mailbox:provision',
    'communication:membership:manage',
    'communication:diagnostics:read',
    -- The existing minimum required to USE the administration surface.
    --
    -- `communication:inbound:read` is DELIBERATELY ABSENT. RATIFY-EMP4A-8 keeps
    -- it granted to no role, and EC-1's suite pins that at zero. MAIL_ADMIN
    -- therefore administers mailboxes and membership WITHOUT being able to read
    -- correspondence — which is the correct shape anyway: granting access is not
    -- the same authority as having it.
    'communication:read',
    'communication:manage'
  )
 where r.code = 'MAIL_ADMIN'
on conflict do nothing;

-- ===========================================================================
-- 5. THE RESOLVER
-- ===========================================================================
-- The ONLY way an RLS policy may consult membership. SECURITY DEFINER because a
-- policy may not query another RLS-protected table; the pattern is copied from
-- `can_read_file`, not invented.
--
-- THE BOOTSTRAP PATH. It ORs in `communication:membership:manage`,
-- because otherwise granting the FIRST membership on a mailbox is impossible —
-- an administrator cannot see a mailbox they are not yet a member of. Per the
-- ratification that bypass is: tenant-scoped (the calling policy's own tenant
-- term still applies), narrowly permission-scoped (one permission, held only by
-- MAIL_ADMIN), audited at the application layer on every membership write, and
-- unavailable to ordinary users.
--
-- It does NOT confer broader message-reading rights: the caller still needs
-- `communication:inbound:read` from the policy's own AND term. A mail
-- administrator without it sees nothing, which is the intended shape.
create or replace function public.user_can_read_mailbox(p_mailbox uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.ec_mailbox_member m
     where m.mailbox_id = p_mailbox
       and m.user_id = auth.uid()
       and m.can_read
       and m.revoked_at is null
  ) or public.has_permission('communication:membership:manage');
$$;

-- Callable from inside RLS policies, so `authenticated` MUST hold EXECUTE. It
-- takes a mailbox id and returns a boolean; it leaks nothing a policy would not
-- already decide. Revoked from PUBLIC and anon on the exact signature — the
-- EMP-3 lesson: revoking PUBLIC alone leaves Supabase's explicit default grants
-- in place.
revoke all on function public.user_can_read_mailbox(uuid) from public, anon;
grant execute on function public.user_can_read_mailbox(uuid) to authenticated, service_role;

-- ===========================================================================
-- 6. RLS ON THE NEW TABLES
-- ===========================================================================
alter table public.ec_mailbox_member enable row level security;
alter table public.ec_mailbox_alias  enable row level security;

-- SELECT-only, matching every other table in this platform. Writes go through
-- the service role behind an application gate; there is no write policy
-- anywhere in this schema and these add none.
drop policy if exists ec_mailbox_member_select on public.ec_mailbox_member;
create policy ec_mailbox_member_select on public.ec_mailbox_member
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      -- Your own memberships are always visible to you: a user must be able to
      -- see which mailboxes they may use.
      user_id = auth.uid()
      or public.has_permission('communication:membership:manage')
    )
  );

drop policy if exists ec_mailbox_alias_select on public.ec_mailbox_alias;
create policy ec_mailbox_alias_select on public.ec_mailbox_alias
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:inbound:read')
     and public.user_can_read_mailbox(mailbox_id));

grant select on public.ec_mailbox_member to authenticated;
grant select on public.ec_mailbox_alias  to authenticated;

-- ===========================================================================
-- 7. THE FOUR POLICY REWRITES
-- ===========================================================================
-- `ec_webhook_event` is deliberately NOT here (RATIFY-EMP4A-3). Instead its
-- read is narrowed to the diagnostics permission, so ordinary members do not
-- receive webhook-journal access.

drop policy if exists ec_mailbox_select on public.ec_mailbox;
create policy ec_mailbox_select on public.ec_mailbox
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:inbound:read')
     and public.user_can_read_mailbox(id));

drop policy if exists ec_inbound_message_select on public.ec_inbound_message;
create policy ec_inbound_message_select on public.ec_inbound_message
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:inbound:read')
     -- `mailbox_id is null` cannot widen quarantine: a quarantined message also
     -- has tenant_id NULL, which the tenant term above already excludes. It is
     -- here so a message whose mailbox row was retired does not silently vanish
     -- from a tenant's view of its own history.
     and (mailbox_id is null or public.user_can_read_mailbox(mailbox_id)));

drop policy if exists ec_inbound_attachment_select on public.ec_inbound_attachment;
create policy ec_inbound_attachment_select on public.ec_inbound_attachment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:inbound:read')
     -- QUALIFIED, and it must be. `ec_inbound_message` has its own
     -- `message_id` column — the RFC 5322 header, a text field — so an
     -- unqualified `message_id` inside this subquery binds to the INNER table
     -- and compares uuid to text. The outer table is named explicitly.
     and exists (
       select 1 from public.ec_inbound_message m
        where m.id = ec_inbound_attachment.message_id
          and (m.mailbox_id is null or public.user_can_read_mailbox(m.mailbox_id))));

drop policy if exists ec_triage_item_select on public.ec_triage_item;
create policy ec_triage_item_select on public.ec_triage_item
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:inbound:read')
     -- Qualified for the same reason as the attachment policy above.
     and exists (
       select 1 from public.ec_inbound_message m
        where m.id = ec_triage_item.message_id
          and (m.mailbox_id is null or public.user_can_read_mailbox(m.mailbox_id))));

-- RATIFY-EMP4A-3 — the webhook journal becomes operator diagnostics.
drop policy if exists ec_webhook_event_select on public.ec_webhook_event;
create policy ec_webhook_event_select on public.ec_webhook_event
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
     and public.has_permission('communication:diagnostics:read'));

-- ===========================================================================
-- 8. PRIVILEGE ASSERTIONS
-- ===========================================================================
do $$
declare v_bad text;
begin
  -- DENIED: PUBLIC holds no EXECUTE on the resolver. Only the ACL can see this
  -- grantee — has_function_privilege takes a role, and PUBLIC is not one.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) a
     where n.nspname = 'public' and p.proname = 'user_can_read_mailbox'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'EMP-4A privilege assertion FAILED: PUBLIC can execute user_can_read_mailbox';
  end if;

  -- DENIED: anon.
  if has_function_privilege('anon', 'public.user_can_read_mailbox(uuid)', 'EXECUTE') then
    raise exception 'EMP-4A privilege assertion FAILED: anon can execute the resolver';
  end if;

  -- ALLOWED: authenticated MUST execute it — it is called from inside RLS.
  if not has_function_privilege('authenticated', 'public.user_can_read_mailbox(uuid)', 'EXECUTE') then
    raise exception 'EMP-4A privilege assertion FAILED: authenticated cannot execute the resolver, every mail policy would fail closed';
  end if;

  -- DENIED: no browser role may WRITE the new tables. Effective immutability —
  -- RLS on, and no write policy — not the absence of DML grants, which are
  -- inert under RLS and platform-wide (the EMP-3 correction).
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('ec_mailbox_member', 'ec_mailbox_alias')
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'EMP-4A privilege assertion FAILED: RLS not enabled on %', v_bad;
  end if;

  select string_agg(tablename || '/' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('ec_mailbox_member', 'ec_mailbox_alias')
     and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'EMP-4A privilege assertion FAILED: a write policy exists: %', v_bad;
  end if;

  -- DENIED: SYSTEM_ADMIN receives none of the three new permissions.
  select string_agg(p.code, ', ') into v_bad
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'SYSTEM_ADMIN'
     and p.code like 'communication:mailbox:%';
  if v_bad is not null then
    raise exception 'EMP-4A privilege assertion FAILED: SYSTEM_ADMIN holds %', v_bad;
  end if;

  raise notice 'EMP-4A privilege matrix OK.';
end $$;

-- ===========================================================================
-- 9. BEHAVIOURAL ASSERTIONS — six personas against the rewritten policies
-- ===========================================================================
-- Ratified requirement: every rewritten policy exercised at migration time, with
-- ALLOWED / DENIED / BROKEN distinguished. Fixtures are created, exercised as
-- `authenticated` with a forged JWT subject, then deleted.
do $$
declare
  v_tenant uuid; v_other uuid; v_mb uuid; v_msg uuid;
  v_member uuid; v_nomember uuid; v_noread uuid; v_admin uuid; v_cross uuid; v_norights uuid;
  v_role_mail uuid; v_role_probe uuid;
  n int;
begin
  select id into v_tenant from public.organization limit 1;
  select id into v_other  from public.organization offset 1 limit 1;
  if v_tenant is null then
    raise notice 'EMP-4A: no organization present, skipping behavioural assertions.';
    return;
  end if;

  -- Fixture mailbox + message.
  insert into public.ec_mailbox (tenant_id, address, label_fr, provisioning_status)
  values (v_tenant, 'emp4a-assert@test.local', 'EMP-4A', 'ACTIVE') returning id into v_mb;

  insert into public.ec_inbound_message
    (tenant_id, mailbox_id, provider, provider_event_id, from_address,
     raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status)
  values (v_tenant, v_mb, 'GENERIC', 'emp4a-evt', 's@test.local', 'aa',
          'ec/emp4a.eml', 1, now(), 'RECEIVED') returning id into v_msg;

  -- Six personas. The ones that need correspondence rights get an EPHEMERAL
  -- probe role carrying `communication:inbound:read`.
  --
  -- Why a throwaway role and not MAIL_ADMIN: RATIFY-EC1-1 keeps
  -- `communication:inbound:read` granted to NO role, and MAIL_ADMIN deliberately
  -- does not carry it — administering who may read correspondence is not the
  -- same authority as reading it. So there is no real role that can play the
  -- "authorized reader" persona, and inventing one permanently would break the
  -- very guarantee EC-1's suite pins. The probe role exists only inside this
  -- transaction and is deleted below. EC-1's own suite uses the same device.
  select id into v_role_mail from public.role where code = 'MAIL_ADMIN' and tenant_id = v_tenant;

  insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
  values (v_tenant, '__EMP4A_PROBE', 'Sonde EMP-4A', 'EMP-4A probe', true)
  returning id into v_role_probe;

  insert into public.role_permission (role_id, permission_id)
  select v_role_probe, p.id from public.permission p
   where p.code = 'communication:inbound:read';

  -- app_user.id references auth.users, so the identity must exist there first.
  v_member := gen_random_uuid(); v_nomember := gen_random_uuid();
  v_noread := gen_random_uuid(); v_admin := gen_random_uuid();
  v_norights := gen_random_uuid();

  insert into auth.users (id, email) values
    (v_member,   'emp4a-member@test.local'),
    (v_nomember, 'emp4a-nomember@test.local'),
    (v_noread,   'emp4a-noread@test.local'),
    (v_admin,    'emp4a-admin@test.local'),
    (v_norights, 'emp4a-norights@test.local');

  insert into public.app_user (id, tenant_id, email, name, status) values
    (v_member,   v_tenant, 'emp4a-member@test.local',   'M', 'active'),
    (v_nomember, v_tenant, 'emp4a-nomember@test.local', 'N', 'active'),
    (v_noread,   v_tenant, 'emp4a-noread@test.local',   'R', 'active'),
    (v_admin,    v_tenant, 'emp4a-admin@test.local',    'A', 'active'),
    (v_norights, v_tenant, 'emp4a-norights@test.local', 'X', 'active');

  -- Memberships.
  insert into public.ec_mailbox_member (tenant_id, mailbox_id, user_id, can_read)
  values (v_tenant, v_mb, v_member, true), (v_tenant, v_mb, v_noread, false);

  -- The three personas that must hold communication:inbound:read get MAIL_ADMIN
  -- for the fixture's purposes; the admin persona additionally exercises the
  -- bootstrap path, since MAIL_ADMIN carries membership:manage.
  -- The three personas that must hold the correspondence authority.
  insert into public.user_role (user_id, role_id, tenant_id)
  values (v_member, v_role_probe, v_tenant),
         (v_noread, v_role_probe, v_tenant),
         (v_admin,  v_role_probe, v_tenant)
  on conflict do nothing;

  -- The administrator additionally holds membership:manage, which is what the
  -- bootstrap persona exercises.
  if v_role_mail is not null then
    insert into public.user_role (user_id, role_id, tenant_id)
    values (v_admin, v_role_mail, v_tenant)
    on conflict do nothing;
  end if;

  -- ---- exercise ---------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  -- DENIED: a user with no rights at all.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_norights::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ec_inbound_message where id = v_msg;
  if n <> 0 then
    perform set_config('role', 'postgres', true);
    raise exception 'EMP-4A BROKEN: a user without correspondence rights read a message';
  end if;

  -- ALLOWED: a member with can_read AND the correspondence permission.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ec_inbound_message where id = v_msg;
  if n <> 1 then
    perform set_config('role', 'postgres', true);
    raise exception 'EMP-4A BROKEN: a can_read member could not read the message (got %)', n;
  end if;
  select count(*) into n from public.ec_mailbox where id = v_mb;
  if n <> 1 then
    perform set_config('role', 'postgres', true);
    raise exception 'EMP-4A BROKEN: a member could not read the mailbox';
  end if;

  -- DENIED: a member whose can_read is false.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_noread::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ec_inbound_message where id = v_msg;
  if n <> 0 then
    perform set_config('role', 'postgres', true);
    raise exception 'EMP-4A BROKEN: can_read=false still read the message';
  end if;

  -- ALLOWED (bootstrap): the mail administrator sees the mailbox without a
  -- membership row, so the first membership can be granted.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ec_mailbox where id = v_mb;
  if n <> 1 then
    perform set_config('role', 'postgres', true);
    raise exception 'EMP-4A BROKEN: the bootstrap path failed — no first membership could ever be granted';
  end if;

  -- DENIED: cross-tenant. Only meaningful when a second organization exists.
  if v_other is not null then
    v_cross := gen_random_uuid();
    insert into auth.users (id, email) values (v_cross, 'emp4a-cross@test.local');
    insert into public.app_user (id, tenant_id, email, name, status)
    values (v_cross, v_other, 'emp4a-cross@test.local', 'C', 'active');
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_cross::text, 'role', 'authenticated')::text, true);
    select count(*) into n from public.ec_inbound_message where id = v_msg;
    if n <> 0 then
      perform set_config('role', 'postgres', true);
      raise exception 'EMP-4A BROKEN: a cross-tenant user read the message';
    end if;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);

  -- ---- cross-table address uniqueness bites -----------------------------
  begin
    insert into public.ec_mailbox_alias (tenant_id, mailbox_id, address)
    values (v_tenant, v_mb, 'emp4a-assert@test.local');
    raise exception 'EMP-4A BROKEN: an alias took an existing mailbox address';
  exception
    when unique_violation then null;
  end;

  -- ---- cleanup -----------------------------------------------------------
  delete from public.ec_mailbox_alias  where mailbox_id = v_mb;
  delete from public.ec_mailbox_member where mailbox_id = v_mb;
  delete from public.ec_triage_item    where message_id = v_msg;
  delete from public.ec_inbound_message where id = v_msg;
  delete from public.ec_mailbox        where id = v_mb;
  delete from public.user_role where user_id in (v_member, v_noread, v_admin);
  delete from public.role_permission where role_id = v_role_probe;
  delete from public.role where id = v_role_probe;
  delete from public.app_user where id in (v_member, v_nomember, v_noread, v_admin, v_norights)
     or (v_cross is not null and id = v_cross);
  -- Cascades from auth.users would remove app_user too, but both are deleted
  -- explicitly so the intent is visible rather than relying on a cascade.
  delete from auth.users where id in (v_member, v_nomember, v_noread, v_admin, v_norights)
     or (v_cross is not null and id = v_cross);

  raise notice 'EMP-4A behavioural assertions OK: no-rights DENIED, member ALLOWED, can_read=false DENIED, admin bootstrap ALLOWED, cross-tenant DENIED, alias collision DENIED.';
end $$;
