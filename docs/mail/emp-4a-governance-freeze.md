# EMP-4A — Governance Freeze & Implementation Brief

**Date:** 2026-08-08 · **Baseline:** EMP-4 complete, migration 88 applied, `/mail` canonical, CI green.
**Status: FREEZE. No SQL may be written until this document is committed.**
All seven EMP-4A ratifications are incorporated. Two findings below **change the ratified scope**
and need your acknowledgement before implementation.

---

## 0. Two findings from the ratification checks

### 0.1 `can_reply_as` is dropped — proven to have no distinct meaning

RATIFY-EMP4A-4 conditioned it on proof. There is none:

`saveDraft` resolves the sender **once** (`resolveMailbox` → `mailbox.address`) and passes it to
`prepare()` for compose and reply alike. The reply branch affects only headers
(`In-Reply-To`/`References`), the audience, and the subject prefix — **never the sender**.
Reply and compose are the same send, so `can_reply_as` would be a synonym for `can_send_as`.

**Capabilities frozen at five:** `can_read` · `can_send` · `can_send_as` ·
`can_manage_members` · `is_default_sender`.

### 0.2 ⚠️ "Send As" does not currently function — the envelope ignores the mailbox

This was not visible at the STOP audit and it materially affects `can_send_as`.

```
dispatch.ts  → sendEmail({ to, toName, subject, html, text })   // no `from`
provider.ts  → resendConfig() → from: process.env.COMMUNICATIONS_EMAIL_FROM
             → buildResendPayload(email, from)
```

EMP-3 resolves, validates and records the sending mailbox — but **the message actually leaves
from one globally configured address**, whichever mailbox was chosen.

**Why this is not fixed in EMP-4A.** Sending as `operations@…` requires that domain to be
verified at the provider. No domain provisioning exists (RATIFY-EMP-4, undone), and passing an
unverified `from` to Resend would turn working sends into failures — strictly worse.

**Ratified position to confirm (RATIFY-EMP4A-8, new):** `can_send_as` governs **authorization** —
who may select a mailbox as the sender of record, and what the ledger and evidence attribute the
send to. It does **not yet** change the SMTP envelope. The gap is stated in the UI rather than
implied away, exactly as `DELIVERED` was refused in EMP-3. **If you would rather `can_send_as`
not exist until the envelope honours it, say so and it comes out of the model.**

---

## 1. Exact schema

Additive only. No table is renamed, no column is dropped, no data is rewritten.

```sql
-- ===========================================================================
-- 1. MAILBOX IDENTITY AND LIFECYCLE (additive columns on the existing table)
-- ===========================================================================
alter table public.ec_mailbox
  add column if not exists mailbox_type text not null default 'SHARED'
    check (mailbox_type in ('SHARED','PERSONAL')),
  add column if not exists provisioning_status text not null default 'ACTIVE'
    check (provisioning_status in
      ('DRAFT','PENDING_EXTERNAL_SETUP','ACTIVE','DISABLED','SETUP_FAILED')),
  add column if not exists owner_user_id uuid references public.app_user (id),
  add column if not exists provisioning_note text,
  add column if not exists provisioning_attempts int not null default 0,
  add column if not exists provisioned_at timestamptz,
  add column if not exists provisioned_by uuid references public.app_user (id);

-- A PERSONAL mailbox names its owner; a SHARED one must not.
alter table public.ec_mailbox add constraint ec_mailbox_owner_shape
  check ((mailbox_type = 'PERSONAL') = (owner_user_id is not null)) not valid;
--                                                                  ^^^^^^^^^
-- NOT VALID: every existing row is SHARED with a NULL owner and satisfies it,
-- but the EMP-3 lesson stands — a narrowing CHECK added to a live table is
-- validated against history by default, so this is stated explicitly rather
-- than discovered in CI.

-- `is_active` is KEPT and stays authoritative for ROUTING, because EC-1's
-- capture path reads it. `provisioning_status` is the ADMINISTRATIVE view.
-- They must never disagree, so a trigger derives one from the other:
--   is_active := (provisioning_status = 'ACTIVE')
-- One writer, no drift. Existing rows: ACTIVE ⇔ is_active, unchanged.

-- ===========================================================================
-- 2. MEMBERSHIP
-- ===========================================================================
create table public.ec_mailbox_member (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  mailbox_id         uuid not null references public.ec_mailbox (id),
  user_id            uuid not null references public.app_user (id),
  can_read           boolean not null default true,
  can_send           boolean not null default false,
  can_send_as        boolean not null default false,
  can_manage_members boolean not null default false,
  is_default_sender  boolean not null default false,
  granted_by         uuid references public.app_user (id),
  granted_at         timestamptz not null default now(),
  revoked_at         timestamptz,          -- REVOKE, never DELETE
  revoked_by         uuid references public.app_user (id),
  revoke_reason      text
);

-- One membership row per (mailbox, user). Revocation sets revoked_at rather
-- than deleting, so "who had access in March" stays answerable; re-granting
-- updates the same row and clears the revocation.
create unique index uq_ec_mailbox_member on public.ec_mailbox_member (mailbox_id, user_id);

-- The resolver's hot path: "which mailboxes may this user read, now?"
create index idx_ec_mailbox_member_user
  on public.ec_mailbox_member (user_id, mailbox_id) where revoked_at is null;

-- At most ONE default sender per user, across all their mailboxes.
create unique index uq_ec_default_sender
  on public.ec_mailbox_member (user_id)
  where is_default_sender and revoked_at is null;

-- send_as without send is incoherent; so is a default sender who cannot send.
alter table public.ec_mailbox_member add constraint ec_member_capability_shape
  check ((not can_send_as or can_send) and (not is_default_sender or can_send));

-- ===========================================================================
-- 3. ALIASES
-- ===========================================================================
create table public.ec_mailbox_alias (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  mailbox_id uuid not null references public.ec_mailbox (id),
  address    text not null,
  is_active  boolean not null default true,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  constraint ec_alias_lowercase check (address = lower(address)),
  constraint ec_alias_shape check (address like '%@%' and length(address) between 3 and 320)
);
create unique index uq_ec_mailbox_alias_address on public.ec_mailbox_alias (address);

-- An alias must not collide with a MAILBOX address either. That is a
-- cross-table uniqueness rule, which no index can express, so it is enforced
-- in the provisioning RPC and asserted behaviourally at migration time.

-- ===========================================================================
-- 4. THE RESOLVER — the only way a policy may consult membership
-- ===========================================================================
create function public.user_can_read_mailbox(p_mailbox uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.ec_mailbox_member m
     where m.mailbox_id = p_mailbox
       and m.user_id = public.auth_app_user_id()
       and m.can_read
       and m.revoked_at is null
  ) or public.has_permission('communication:mailbox:membership:manage');
$$;
```

**Why the resolver ORs in the administration permission:** a mail administrator must be able to
see a mailbox in order to manage its membership. Without it, granting the first membership on a
mailbox would be impossible — a bootstrap deadlock.

`SECURITY DEFINER` is required because an RLS policy may not query another RLS-protected table;
the pattern is copied from `can_read_file` (`20260614000005_scope_visibility.sql`), not invented.

---

## 2. Exact rewritten policies

**Four policies. `ec_webhook_event` is untouched** (RATIFY-EMP4A-3 — no mailbox attribution).

```sql
-- ec_mailbox
using (tenant_id = public.auth_tenant_id()
   and public.has_permission('communication:inbound:read')
   and public.user_can_read_mailbox(id));

-- ec_inbound_message
using (tenant_id = public.auth_tenant_id()
   and public.has_permission('communication:inbound:read')
   and (mailbox_id is null or public.user_can_read_mailbox(mailbox_id)));

-- ec_inbound_attachment  (no mailbox column — resolved through its message)
using (tenant_id = public.auth_tenant_id()
   and public.has_permission('communication:inbound:read')
   and exists (select 1 from public.ec_inbound_message m
                where m.id = message_id
                  and (m.mailbox_id is null or public.user_can_read_mailbox(m.mailbox_id))));

-- ec_triage_item        (same, through its message)
using (tenant_id = public.auth_tenant_id()
   and public.has_permission('communication:inbound:read')
   and exists (select 1 from public.ec_inbound_message m
                where m.id = message_id
                  and (m.mailbox_id is null or public.user_can_read_mailbox(m.mailbox_id))));
```

**`mailbox_id is null` is deliberate and load-bearing.** A quarantined message has no mailbox
(and no tenant), so it remains unreachable by construction — this clause does not widen it. It
exists so a message whose mailbox was later removed does not become invisible in a way that
silently rewrites what a tenant can see about its own history.

**Membership is AND, never OR.** Every predicate keeps `has_permission('communication:inbound:read')`.
Membership narrows; it can never substitute for the correspondence authority.

### Behavioural exercise at migration time — six personas, three verdicts

Each of the four policies is exercised as: **unauthorized tenant user · authorized tenant user
without membership · member with `can_read` · member with `can_read = false` · cross-tenant user ·
mail administrator**, classifying **ALLOWED / DENIED / BROKEN** separately, and asserting
`SELECT` is still preserved for the allowed cases. A policy that denies everyone would otherwise
"pass".

---

## 3. Role / permission matrix — **PROPOSED, NOT SEEDED**

Three new permissions (RATIFY-EMP4A-5): `communication:mailbox:provision` ·
`communication:mailbox:membership:manage` · `communication:mailbox:diagnostics:read`.

**No existing role is an obvious safe owner, so per RATIFY-EMP4A-6 this is returned for approval
and nothing is seeded.** The facts:

* `communication:manage` is held today by exactly **`SYSTEM_ADMIN`** and **`OPS_SUPERVISOR`**.
* **`SYSTEM_ADMIN` is ratified out** of the new permissions.
* `communication:inbound:read` is held by **no role** (RATIFY-EC1-1) — so today nobody can read
  correspondence at all, membership or not.

| Permission | Proposed holder | Rationale |
|---|---|---|
| `communication:mailbox:provision` | **New role `MAIL_ADMIN`** | Reserving addresses and creating mailbox identities is a tenant-administration act, but the only existing administrator is ratified out. A dedicated role keeps it explicit and grantable to one person. |
| `communication:mailbox:membership:manage` | **`MAIL_ADMIN`**, optionally `OPS_SUPERVISOR` | Supervisors already hold `communication:manage` and administer mailboxes; extending them to membership is defensible but widens an existing role. **Your call.** |
| `communication:mailbox:diagnostics:read` | **`MAIL_ADMIN`** only | Webhook journal is operator diagnostics (RATIFY-EMP4A-3); ordinary members must not receive it. |

**Alternative if a new role is unwanted:** grant all three to `OPS_SUPERVISOR` alone. This is
smaller but makes every operations supervisor a mail administrator, which is a real widening of
a role that ~several people hold.

**Nothing is seeded until you choose.** Three-source rule applies: migration + `seed.sql` +
`role-templates.ts`, with the parity test (`count == N roles`).

---

## 4. User-onboarding transaction boundaries

**The account and the mailbox are never in one transaction.** RATIFY-EMP4A-7: mailbox failure
must never roll back or orphan a user.

```
TXN 1  createUser (unchanged)      → app_user + user_role committed
       ─────────── commit ───────────
       (department DERIVED from roles — Phase 9.0A, there is no column to set)
TXN 2  suggest eligible shared mailboxes   [read-only, no write]
TXN 3  per mailbox: insert ec_mailbox_member                 → committed, audited
TXN 4  optional: create PERSONAL ec_mailbox in DRAFT         → committed, audited
       → operator performs external setup out-of-band
TXN 5  operator records outcome: ACTIVE or SETUP_FAILED      → committed, audited
TXN 6  sendStaffWelcome (unchanged, existing action)
```

**If TXN 3–5 fail, the user still exists, signs in, and holds their roles.** The mailbox is
`DRAFT` or `SETUP_FAILED` and appears in a retry queue. `createUser` is **not modified** — the
mailbox steps are a separate, resumable flow reached from the same screen.

**Eligibility is a suggestion, never an automatic grant.** `canonicalDepartmentsForRoles(roles)`
proposes shared mailboxes; an administrator confirms. Membership is always an explicit act with
a named grantor, because "the system added it" is not an answer to "who gave them access?".

---

## 5. Operator-assisted provisioning workflow

```
DRAFT ──provision──▶ PENDING_EXTERNAL_SETUP ──operator confirms──▶ ACTIVE
                              │                                      │
                              └──operator reports failure──▶ SETUP_FAILED
                                                                  │
                                                            retry ─┘ (back to PENDING)
ACTIVE ──disable──▶ DISABLED ──enable──▶ ACTIVE
```

* **No external API call exists or is simulated.** "Provision" reserves the internal identity,
  validates the address against the global unique index and the alias table, and records intent.
* **A retry is an audited internal/operator retry** — it increments `provisioning_attempts` and
  returns the mailbox to `PENDING_EXTERNAL_SETUP`. It calls nothing.
* **`SETUP_FAILED` is only ever set by a human**, which is what makes it honest: the platform
  cannot observe an external failure, so it records that an operator reported one.
* `is_active` — and therefore routing — follows `provisioning_status = 'ACTIVE'` through the
  derivation trigger. A mailbox in any other state cannot receive or send.

---

## 6. Hosted-Supabase privilege assertions

The EMP-3 lessons apply in full, at migration time:

1. **Revoke from `public`, `anon` AND `authenticated`** on every new function, using the **exact
   identity signature** — revoking `PUBLIC` alone leaves Supabase's explicit default-privilege
   grants intact, which is invisible on a bare local Postgres.
2. **Grant `EXECUTE` to `service_role` only** for provisioning RPCs. `user_can_read_mailbox` is
   the exception: it is called **inside RLS policies**, so it must be executable by
   `authenticated` — it takes a mailbox id, returns a boolean, and leaks nothing a policy would
   not already decide.
3. **Assert through both mechanisms**: `has_function_privilege` for effective privilege, and
   `aclexplode` (grantee `0`) / `information_schema.routine_privileges` for grants — only the
   latter can see `PUBLIC`.
4. **New tables**: RLS on, SELECT-only policies, writes via service role behind an app gate.
   Assert **effective immutability** — RLS enabled plus no `ALL/INSERT/UPDATE/DELETE` policy —
   **not** the absence of DML grants, which are inert under RLS and platform-wide.
5. Assert `service_role` **can** execute; a matrix that denies everyone would pass while
   breaking provisioning.

---

## 7. Rollback strategy

| Object | Rollback |
|---|---|
| `ec_mailbox_member`, `ec_mailbox_alias` | Drop. No other table references them. |
| `ec_mailbox` columns | Drop. `is_active` was never removed and remains authoritative for routing, so capture and EMP-1 keep working. |
| Four rewritten policies | **The real risk.** Restore the original predicates verbatim; they are recorded in this document and in `20260804000001`. |
| `user_can_read_mailbox` | Drop after the policies are restored, never before — dropping it first makes four policies fail closed and blinds the workspace. |
| Three permissions | Revoke at all three sources. |

**Order matters on rollback: policies first, then the function.** A `DROP FUNCTION ... CASCADE`
would silently drop the policies with it and leave the tables with **no** SELECT policy — which
denies everything rather than restoring the old behaviour. Use explicit statements, never
`CASCADE`.

**Forward-only in production:** rollback is a new migration, never an edit to 89.

---

## 8. Tests

**SQL suite** (`rls_mailbox_membership_test.sql`, wired last in CI):
the six personas × four policies with ALLOWED/DENIED/BROKEN; membership is AND not OR (a member
without `communication:inbound:read` still sees nothing); `can_read` false denies; revoked
membership denies; cross-tenant denies; the administrator bootstrap works; one default sender per
user; `can_send_as` without `can_send` refused; alias/mailbox address collision refused; the
`is_active` ⇔ `ACTIVE` derivation holds; `ec_webhook_event` remains tenant-scoped and **not**
membership-scoped; the privilege matrix of §6.

**TypeScript contracts:** no second identity model; no provider integration
(no IMAP/POP3/Exchange/`createMailbox`); no AI; no customer visibility; no new bucket;
`can_reply_as` absent; `createUser` **unmodified**; onboarding writes the mailbox outside the
user transaction; eligibility suggests and never auto-grants; every membership change audited
with who/when/old/new/reason; `SYSTEM_ADMIN` holds none of the three permissions; provisioning
calls no external service; retry increments attempts and calls nothing.

---

## 9. What I need before writing SQL

1. **§0.2** — confirm `can_send_as` ships as an authorization-only capability with the envelope
   gap stated, **or** direct that it be omitted until the envelope honours it.
2. **§3** — choose the role matrix: new `MAIL_ADMIN`, or grant to `OPS_SUPERVISOR`.

Everything else is frozen and unambiguous. On those two answers the implementation order is:
migration 89 → resolver → policies + assertions → membership service → onboarding integration →
`Administration → Users → Enterprise Mail` → tests → CI.

**No SQL has been written. EMP-5 remains untouched.**
