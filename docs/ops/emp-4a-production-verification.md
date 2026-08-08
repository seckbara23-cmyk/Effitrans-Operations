# EMP-4A — Migration 89 production verification (READ-ONLY) and operator guide

**Date:** 2026-08-08 · **Migration:** `20260813000001_mailbox_membership.sql` — **applied via the
Supabase SQL Editor.** Do not modify or re-apply it.

> **Boundary I must state.** This environment has no Docker, no `psql` and no authorized Supabase
> MCP, so **I cannot query your database.** Everything in §1–§2 is SQL for you to run; I am not
> reporting its output as if I had. Every statement is `SELECT`-only.

---

## 1. Read-only verification pack

Run these in order. Each states the expected result; anything else should stop the rollout.

### 1.1 The two new tables exist with the frozen schema

```sql
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('ec_mailbox_member','ec_mailbox_alias')
 order by table_name, ordinal_position;
```
**Expect** — `ec_mailbox_member`: `id, tenant_id, mailbox_id, user_id, can_read, can_send,
can_manage_members, is_default_sender, granted_by, granted_at, revoked_at, revoked_by,
revoke_reason` (13). **`can_send_as` and `can_reply_as` must NOT appear.**
`ec_mailbox_alias`: `id, tenant_id, mailbox_id, address, is_active, created_by, created_at` (7).

### 1.2 `ec_mailbox` lifecycle columns

```sql
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='ec_mailbox'
   and column_name in ('mailbox_type','provisioning_status','owner_user_id',
                       'provisioning_note','provisioning_attempts','provisioned_at','provisioned_by');
```
**Expect** 7 rows; `mailbox_type` default `'SHARED'`, `provisioning_status` default `'ACTIVE'`.

### 1.3 Indexes and constraints

```sql
select indexname, indexdef from pg_indexes
 where schemaname='public'
   and indexname in ('uq_ec_mailbox_member','idx_ec_mailbox_member_user',
                     'uq_ec_default_sender','uq_ec_mailbox_alias_address','idx_ec_mailbox_alias_mailbox');

select conname, pg_get_constraintdef(oid), convalidated
  from pg_constraint
 where conname in ('ec_member_capability_shape','ec_member_revoke_shape',
                   'ec_mailbox_owner_shape','ec_alias_lowercase','ec_alias_shape');
```
**Expect** 5 indexes (`uq_ec_default_sender` partial on `is_default_sender AND revoked_at is null`)
and 5 constraints. `ec_mailbox_owner_shape` should show **`convalidated = false`** — it was added
`NOT VALID` on purpose so it governs new rows without re-validating history.

### 1.4 The resolver and its privileges

```sql
select p.proname, p.prosecdef as security_definer, p.provolatile,
       pg_get_functiondef(p.oid) like '%communication:membership:manage%' as has_bootstrap
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='user_can_read_mailbox';

-- Effective privilege (roles) …
select has_function_privilege('anon','public.user_can_read_mailbox(uuid)','EXECUTE')          as anon_exec,
       has_function_privilege('authenticated','public.user_can_read_mailbox(uuid)','EXECUTE') as authd_exec,
       has_function_privilege('service_role','public.user_can_read_mailbox(uuid)','EXECUTE')  as svc_exec;

-- … and PUBLIC, which is not a role and only the ACL can see.
select count(*) as public_execute_grants
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(p.proacl) a
 where n.nspname='public' and p.proname='user_can_read_mailbox'
   and a.grantee=0 and a.privilege_type='EXECUTE';
```
**Expect** `security_definer = true`, `provolatile = 's'` (stable), `has_bootstrap = true`;
`anon_exec = false`, **`authd_exec = true`** (it runs *inside* RLS — false would fail every mail
policy closed), `svc_exec = true`, `public_execute_grants = 0`.

### 1.5 The rewritten policies — and that membership is an AND, never an alternative

```sql
select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname='public'
   and tablename in ('ec_mailbox','ec_inbound_message','ec_inbound_attachment',
                     'ec_triage_item','ec_webhook_event','ec_mailbox_member','ec_mailbox_alias')
 order by tablename;
```
**Expect** exactly one `SELECT` policy per table (7 rows), and in the four rewritten ones the
`qual` must contain **all three** of `auth_tenant_id()`, `has_permission('communication:inbound:read')`
and `user_can_read_mailbox`. **The mechanical check:**

```sql
-- Membership must never be an ALTERNATIVE authorization path.
select tablename, policyname
  from pg_policies
 where schemaname='public'
   and tablename in ('ec_mailbox','ec_inbound_message','ec_inbound_attachment','ec_triage_item')
   and (qual not like '%communication:inbound:read%' or qual not like '%user_can_read_mailbox%');
```
**Expect 0 rows.** A row here means a policy would admit membership *without* the correspondence
authority — the one failure mode that would turn a narrowing into a widening.

```sql
-- ec_webhook_event is diagnostics-only and NOT membership-scoped (RATIFY-EMP4A-3).
select qual like '%communication:diagnostics:read%' as diag_gated,
       qual like '%user_can_read_mailbox%'          as wrongly_membership_scoped
  from pg_policies where schemaname='public' and tablename='ec_webhook_event';
```
**Expect** `true`, `false`.

### 1.6 No unexpected write policy

```sql
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and cmd in ('ALL','INSERT','UPDATE','DELETE');
```
**Expect 0 rows** — platform-wide. This schema has never had a write policy on any table; writes
go through the service role behind application gates.

### 1.7 Authorization model — three sources agreeing

```sql
select code, module, action, data_scope from public.permission
 where code in ('communication:mailbox:provision','communication:membership:manage',
                'communication:diagnostics:read');

select o.name as tenant, r.code, r.label_fr, count(rp.permission_id) as perms
  from public.role r
  join public.organization o on o.id = r.tenant_id
  left join public.role_permission rp on rp.role_id = r.id
 where r.code = 'MAIL_ADMIN'
 group by 1,2,3 order by 1;

select p.code from public.role r
  join public.role_permission rp on rp.role_id=r.id
  join public.permission p on p.id=rp.permission_id
 where r.code='MAIL_ADMIN' order by 1;
```
**Expect** the 3 permissions; one `MAIL_ADMIN` row **per tenant**; and its permission list to be
exactly: `communication:diagnostics:read`, `communication:manage`,
`communication:mailbox:provision`, `communication:membership:manage`, `communication:read`
(+ `profile:read:self`, `profile:update:self` if the seed ran).

**`communication:inbound:read` must NOT be in that list.**

### 1.8 The two governance invariants

```sql
-- (a) communication:inbound:read is granted to NO role. Expect 0.
select count(*) from public.role_permission rp
  join public.permission p on p.id=rp.permission_id
 where p.code='communication:inbound:read';

-- (b) SYSTEM_ADMIN holds no mailbox administration. Expect 0.
select count(*) from public.role r
  join public.role_permission rp on rp.role_id=r.id
  join public.permission p on p.id=rp.permission_id
 where r.code='SYSTEM_ADMIN'
   and p.code in ('communication:mailbox:provision','communication:membership:manage',
                  'communication:diagnostics:read','communication:inbound:read');
```

### 1.9 No historical evidence was mutated, deleted or rewritten

The corrected probe persists nothing, so these should show your real data untouched and **no
synthetic rows**:

```sql
-- No probe residue anywhere. Expect 0 for each.
select count(*) from public.ec_mailbox        where address like 'emp4a-%';
select count(*) from public.ec_inbound_message where provider_event_id like 'emp4a-%';
select count(*) from public.app_user           where email like 'emp4a-probe-%';
select count(*) from public.role               where code like '\_\_EMP4A%';
select count(*) from auth.users                where email like 'emp4a-probe-%';

-- Inbound evidence still immutable and intact.
select count(*) as messages, min(received_at), max(received_at) from public.ec_inbound_message;
select count(*) as attachments from public.ec_inbound_attachment;
select count(*) as webhook_events from public.ec_webhook_event;

-- Correspondence history was never rewritten: no ledger row was touched.
select event_type, count(*) from public.business_event
 where event_domain='communication' group by 1 order by 1;
```
**Expect** the counts to match what you had before migration 89. Nothing in 89 writes to
`business_event`, and the three EC evidence tables remain append-only — `prevent_mutation` was
never weakened, disabled or exempted.

```sql
-- The append-only triggers are still attached. Expect 3 rows.
select c.relname, t.tgname from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_proc  p on p.oid=t.tgfoid
 where p.proname='prevent_mutation' and not t.tgisinternal
   and c.relname in ('ec_inbound_message','ec_inbound_attachment','ec_webhook_event');
```

### 1.10 Routing is unchanged

```sql
select provisioning_status, is_active, count(*)
  from public.ec_mailbox group by 1,2 order by 1;
```
**Expect** `is_active` **true only** for `ACTIVE`. Migration 89 moved existing *inactive* mailboxes
to `DISABLED` and never the reverse, so no mailbox started routing that was not routing before.

---

## 2. Migration ledger

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
select count(*) as total from supabase_migrations.schema_migrations;
```

Applying through the **SQL Editor** executes the DDL but does **not** write the ledger row. If
`20260813000001` is absent while §1 shows the objects present, reconcile with:

```bash
supabase migration repair --status applied 20260813000001
```

Check `20260812000001` (migration 88) the same way — it was applied the same route:

```bash
supabase migration repair --status applied 20260812000001
```

Then confirm:

```bash
supabase migration list
```
**Expect the ledger to read 89/89**, with local and remote agreeing.

**Do not run `supabase db push`** and do not re-run the migration: the schema is already there,
and `repair` is the sanctioned way to make the ledger say so.

---

## 3. What an administrator needs to use Administration → Utilisateurs → Enterprise Mail

### 3.1 Bootstrapping the first MAIL_ADMIN

The role now exists in every tenant, with no members. The bootstrap works because the two
authorities are deliberately separate:

> **SYSTEM_ADMIN can assign roles but cannot read correspondence. MAIL_ADMIN can administer
> mailboxes but also cannot read correspondence.** Neither can grant itself the other's power.

1. Sign in as a **SYSTEM_ADMIN** (holds `admin:users:manage` / `admin:users:update`).
2. Go to **Administration → Utilisateurs**, open the person who will administer mail.
3. Assign the role **« Administrateur messagerie » (MAIL_ADMIN)**.
4. That user signs out and back in so their permissions refresh.

They will then see **Administration → Utilisateurs → Enterprise Mail** in the sidebar. A
SYSTEM_ADMIN will **not** see that entry — that is correct, not a bug, and the navigation test
asserts it.

### 3.2 Reserving a mailbox (operator-assisted, by design)

In the panel, "Réserver une boîte" takes an address, a label and a purpose, and creates it in
**`PENDING_EXTERNAL_SETUP`**. Nothing is created at any provider — this platform integrates none.

Then, outside Effitrans, create the real mailbox at your mail provider. Come back and either
**« Configuration externe confirmée »** → `ACTIVE` (routing turns on) or **« Signaler un échec »**
→ `SETUP_FAILED` with a note. A failure can be retried; the retry re-asks the operator and
increments the attempt count. It calls nothing.

### 3.3 Giving existing users mailbox membership

From the same panel, select a mailbox and grant membership per user, choosing capabilities
independently: **lecture**, **envoi**, **gestion des membres**, **expéditeur par défaut**.
Revoking never deletes — the row keeps its history with a reason, so "who had access in March"
stays answerable.

Eligibility is computed from the user's **role-derived department** (Phase 9.0A: departments are
derived from roles, not stored) and is a **suggestion only** — an administrator confirms, so every
membership row names its grantor.

### 3.4 ⚠️ The thing to know before you plan a rollout

**Granting membership does not yet let anyone read mail.** Every rewritten policy is
`tenant AND communication:inbound:read AND membership`, and `communication:inbound:read` is still
granted to **no role** (RATIFY-EC1-1, restated by RATIFY-EMP4A-8). So today:

* ✅ mailboxes can be reserved, confirmed, disabled and retried;
* ✅ memberships can be granted and revoked, with full audit;
* ❌ **nobody can open the inbox** — `/mail/inbox` 404s for every user.

The Enterprise Mail *workspace* becomes usable only when RATIFY-EC1-1 grants
`communication:inbound:read` to a role. At that moment the narrowing lands: a holder of that
permission sees **only** the mailboxes they are a member of. That is the intended shape, and
memberships should be in place **before** the permission is granted, not after.

### 3.5 There is no "Send As"

The provider envelope always uses the central configured sender, so no such control exists and
none is displayed. `can_send` authorizes initiating correspondence associated with a mailbox
*inside* Effitrans and makes no claim about what the recipient sees. Sender identity arrives in
**EMP-4B**, after verified sending domains exist.
