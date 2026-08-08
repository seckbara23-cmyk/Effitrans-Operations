# EMP-4A — Mailbox Membership & User Provisioning: AUDIT + **STOP**

**Date:** 2026-08-08 · **Baseline:** EMP-4 complete, migration 88 applied, CI green, `/mail` canonical.
**Status: STOP BEFORE SQL. No code, no migration, no schema was written.**

---

## 0. Why this stops

The brief's own condition: *"STOP immediately if introducing mailbox membership requires
widening an existing security boundary beyond what the audit supports."*

**It does — and not in the direction one would expect.** Membership itself is a *narrowing*.
The problem is what has to change for it to mean anything:

> To make membership govern who reads mail, **five deployed RLS policies on evidence tables must
> be rewritten** — `ec_mailbox`, `ec_webhook_event`, `ec_inbound_message`,
> `ec_inbound_attachment`, `ec_triage_item`. Every one currently reads
> `tenant_id = auth_tenant_id() AND has_permission('communication:inbound:read')`.

That is a change **to** the deployed security model, not an addition **beside** it. Combined with
three further findings below, the honest call is to return the model and let you ratify it rather
than to write SQL and report afterwards.

**Two further blockers, either of which alone would justify stopping:**

1. **"Provisioning" cannot provision.** There is **no provider or domain automation anywhere in
   this codebase** — verified by search. The lifecycle the brief specifies
   (`pending / active / disabled / failed provisioning`, "failures must be retryable") describes
   an external action the platform cannot perform or observe. Building it would create a
   `failed` state nothing can produce and a `retry` that retries nothing.
2. **Nobody can be given provisioning authority without a decision.** `SYSTEM_ADMIN` is excluded
   from correspondence by EC-1's own stated requirement, and `communication:inbound:read` is
   granted to **no role at all** (RATIFY-EC1-1). The audit cannot decide who provisions.

---

## 1. Architecture discovered

### 1.1 Mailbox membership — **does not exist**

Searched for `mailbox_member`, `mailbox_membership`, `ec_mailbox_user`, `send_as`: **zero hits**
across all 88 migrations and the entire `lib/`. There is nothing to reuse and nothing to extend.

### 1.2 `ec_mailbox` as it stands

```
id, tenant_id, address, label_fr, purpose, is_active, note, created_by, created_at, updated_at
constraints: address = lower(address); address like '%@%' and length 3..320
uq_ec_mailbox_address on (address)   -- GLOBAL, deliberately not per-tenant
RLS: SELECT only — tenant_id = auth_tenant_id() AND has_permission('communication:inbound:read')
```

* **No member concept, no owner, no capability.** "Who may use this mailbox" is answered today
  only by a tenant-wide permission.
* **Uniqueness is already global and already correct** for both personal and shared addresses —
  EC-1's reason: two tenants claiming one address makes routing a guess. **Do not duplicate
  address validation**; the CHECKs and the unique index already exist.
* **No INSERT/UPDATE/DELETE policy** on any `ec_*` table. Creation is a service-role act; EMP-1
  administers `is_active` through the admin client behind `communication:manage`.
* Lifecycle today is **one boolean**, not four states.

### 1.3 The five policies membership would have to change

| Table | Current predicate |
|---|---|
| `ec_mailbox` | `tenant + has_permission('communication:inbound:read')` |
| `ec_webhook_event` | same |
| `ec_inbound_message` | same |
| `ec_inbound_attachment` | same |
| `ec_triage_item` | same |

An RLS policy **may not query another RLS-protected table directly**, so membership must be
resolved through a `SECURITY DEFINER` function — the pattern already exists
(`can_read_file`, `user_readable_file_ids` in `20260614000005_scope_visibility.sql`) and should
be copied rather than invented.

### 1.4 User creation pipeline

`createUser({ email, name, password, roleIds, sendWelcome, credentialMode, status })` —
gated by `assertAnyPermission(userAdminCodes("create"))`, validates every role against the
tenant catalogue and refuses non-assignable staff roles. `sendStaffWelcome` exists separately.

**There is no "assign department" step, because departments are DERIVED from roles**
(Phase 9.0A — `canonicalDepartmentsForRoles`, no department column on the user). The brief's
onboarding diagram has a step the data model does not have: eligibility must key off the
**role-derived** department, not a stored field.

### 1.5 Identity

Two distinct identities exist: `app_user` (login, roles, tenant) and `employee` (HR-1 registry,
**account-less employees are legitimate** — an employee record grants nothing). Membership must
key on **`app_user`**, since a mailbox is used by someone who signs in. Whether an account-less
employee may hold membership is a governance question, not a technical one.

### 1.6 Provider / domain provisioning — **none**

No `createMailbox`, no `provisionMailbox`, no domain or DNS API anywhere. The only provider
integration is Resend **sending** (`lib/comms/provider.ts`), which cannot create a mailbox. Per-
tenant sending domains were deferred at EMP-0 as **RATIFY-EMP-4** and remain undone.

### 1.7 Reusable as-is

`admin:users:*` (8 codes) · `/users` and `/users/[id]` · `createUser` / `sendStaffWelcome` ·
`writeAudit` and `audit_log` (append-only, satisfies "who/when/old/new/reason") ·
`canonicalDepartmentsForRoles` · EMP-1's mailbox administration surface ·
the `SECURITY DEFINER` resolver pattern · global address uniqueness and its CHECKs ·
the Enterprise Mail nav and `/mail` workspace.

---

## 2. Smallest additive model

Two tables, one column, one resolver, three permissions. Nothing more.

```sql
-- 1. MEMBERSHIP. One row per (mailbox, user), capabilities as explicit booleans
--    so read never implies send-as.
create table public.ec_mailbox_member (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  mailbox_id    uuid not null references public.ec_mailbox (id),
  user_id       uuid not null references public.app_user (id),
  can_read      boolean not null default true,
  can_send_as   boolean not null default false,   -- NEVER implied by can_read
  can_reply_as  boolean not null default false,
  can_manage    boolean not null default false,
  granted_by    uuid references public.app_user (id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,                      -- revoke, never delete
  unique (mailbox_id, user_id)
);

-- 2. ALIASES. Globally unique, same rule and shape as the mailbox address.
create table public.ec_mailbox_alias (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  mailbox_id uuid not null references public.ec_mailbox (id),
  address    text not null,
  is_active  boolean not null default true,
  constraint ec_alias_lowercase check (address = lower(address)),
  constraint ec_alias_shape check (address like '%@%' and length(address) between 3 and 320)
);
create unique index uq_ec_mailbox_alias_address on public.ec_mailbox_alias (address);
-- and it must not collide with a mailbox address either — enforced in the
-- provisioning RPC, since a cross-table unique index is not expressible.

-- 3. LIFECYCLE on the existing table, additive, defaulting to today's meaning.
alter table public.ec_mailbox
  add column if not exists status text not null default 'ACTIVE'
    check (status in ('PENDING','ACTIVE','DISABLED','FAILED')),
  add column if not exists provisioning_note text,
  add column if not exists provisioned_at timestamptz;
-- `is_active` is KEPT and stays authoritative for routing, because EC-1's
-- capture path reads it. `status` is the administrative view. They must not be
-- allowed to disagree: a CHECK or trigger should tie is_active = (status='ACTIVE').

-- 4. RESOLVER — the only way an RLS policy may consult membership.
create function public.user_can_read_mailbox(p_mailbox uuid) returns boolean
  language sql security definer stable ...;
```

**Then the unavoidable part:** each of the five `ec_*` SELECT policies becomes
`tenant AND has_permission('communication:inbound:read') AND public.user_can_read_mailbox(<mailbox>)`
— which is exactly why this is a STOP and not a patch. `ec_webhook_event` has **no mailbox
column at all**, so it cannot be scoped by membership without either a join through
`provider_event_id` or a decision to leave it tenant-wide.

**Three new permissions** (three-source rule: migration + `seed.sql` + `role-templates.ts`):
`mailbox:provision` · `mailbox:membership:manage` · `mailbox:send_as`.
Keeping them separate from `communication:*` is deliberate — mailbox administration is not
correspondence reading.

---

## 3. Security implications

* **Membership narrows, and that is the risk to manage, not celebrate.** Once the five policies
  require membership, a holder of `communication:inbound:read` who is a member of nothing sees
  **nothing**. Today they would see everything. Because the permission is granted to no role,
  there is no live blast radius — but the change is invisible until RATIFY-EC1-1 lands, and then
  it lands all at once.
* **Membership must be AND, never OR.** `permission AND membership`. A model where membership
  alone grants read would let mailbox administration escalate into correspondence access.
* **`can_read` must never imply `can_send_as`** — the brief's rule, and the reason capabilities
  are separate columns rather than a single enum.
* **`SYSTEM_ADMIN` must gain nothing**, per EC-1's own requirement.
* New tables need the full treatment already standard here: RLS on, SELECT-only policies, writes
  through the service role behind an app gate, `REVOKE`/`GRANT` on any function against the
  **exact identity signature** (the EMP-3 lesson), and assertions that prove the matrix.
* **Revoke, never delete** membership — otherwise "who had access in March" becomes unanswerable.

## 4. Governance implications — decisions the audit cannot make

| Ref | Decision |
|---|---|
| **RATIFY-EMP4A-1** | **What does "provision" mean** when no provider automation exists? Recommended: it records **intent and state** — an operator creates the real mailbox out-of-band and marks it ACTIVE. Then `FAILED` means *the operator reported failure*, and `retry` means *ask again*, both honest. |
| **RATIFY-EMP4A-2** | Membership as **gate** (rewrite the five policies) or as **scope only in the application** (policies unchanged, membership filters in the service layer)? The second is far smaller and reversible; the first is stronger. **This is the load-bearing choice.** |
| **RATIFY-EMP4A-3** | Who holds `mailbox:provision`? `SYSTEM_ADMIN` is excluded from EC by EC-1's requirement, so a new or existing admin role must be named. |
| **RATIFY-EMP4A-4** | `ec_webhook_event` has no mailbox column — leave tenant-wide, or scope it? |
| **RATIFY-EMP4A-5** | May an **account-less employee** (HR-1) hold membership, or only an `app_user`? |
| **RATIFY-EMP4A-6** | Does onboarding **block** on mailbox provisioning? The brief says failure must not orphan the account — recommended: provisioning is a **separate, retryable step after** user creation commits, never in its transaction. |
| **RATIFY-EMP4A-7** | The six shared mailboxes (`operations@`…`support@`) need a **domain**. None is configured (RATIFY-EMP-4). Seed them as `PENDING` against a placeholder, or wait for the domain? |

## 5. What can proceed with no decision at all

If you want movement before ratifying, these are safe and additive, and I can build them now:

1. **`Administration → Users → Enterprise Mail`** as a **read-only** surface: which mailboxes
   exist, their state, and — once membership lands — who is a member. No writes, no new
   permission (`admin:users:read` + `communication:manage`).
2. **Nav placement** under Administration, alongside Utilisateurs.
3. The **audit vocabulary** (`ec.mailbox.member_added`, `…member_revoked`, `…provisioned`) added
   to `AuditActions` — additive, unused until the model exists.

Everything that writes membership, changes a policy, or claims to provision waits.

---

## 6. Deliverable summary

* **Architecture discovered:** §1 — membership does not exist; `ec_mailbox` is a boolean with a
  globally unique address; five policies are tenant-wide; departments are derived; no provider
  automation exists.
* **Required migration:** §2 — two tables, three columns, one resolver, three permissions, **and
  a rewrite of five deployed RLS policies**.
* **Security implications:** §3 — membership must be AND not OR; read never implies send-as; the
  narrowing lands all at once when RATIFY-EC1-1 does.
* **Governance implications:** §4 — seven decisions, of which **RATIFY-EMP4A-2** (gate vs scope)
  determines the size of everything else.
* **Smallest additive model:** §2.

**No SQL was written. EMP-4A implementation has not begun. EMP-5 has not begun.**
