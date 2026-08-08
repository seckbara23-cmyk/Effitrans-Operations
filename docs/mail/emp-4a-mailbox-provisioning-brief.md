# EMP-4A — Mailbox Membership and User Provisioning: RATIFIED SCOPE (not begun)

**Date registered:** 2026-08-08 · **Status: NOT STARTED. Audit-first phase, separate from EMP-4.**
Recorded here so the ratification is not lost. **No code, schema or audit work has been done.**

EMP-4 (attachment → document ingestion) remains unchanged and does not touch any of this.

---

## Ratified model — RATIFY-EMP-MAILBOX-PROVISIONING

Mailbox provisioning is integrated into **user administration**, distinguishing:

1. **Shared departmental mailboxes**
2. **Personal professional mailboxes**

### New-user workflow
Create the user first → assign role and department → determine eligible shared mailboxes
automatically → grant membership per approved mappings → offer an **explicit optional** action
to create a personal professional mailbox.

* **Never** silently create a live external mailbox for every user.
* Mailbox failure **must not** roll back or orphan the user account.
* Failed provisioning must be **visible, audited and retryable**.

### Existing-user workflow
An admin mailbox-access surface: assign shared access, create a personal mailbox, and
**previewed** bulk provisioning. Ordinary users may never create arbitrary external mailboxes.

### Membership must distinguish four capabilities
`read` · `send-as` · `mailbox management` · `mailbox provisioning`.

**A user who can read a mailbox does not automatically gain send-as authority.**

---

## Required audit before any implementation

Current `ec_mailbox` ownership model · the user-creation pipeline · department and role mappings ·
whether mailbox membership already exists · provider/domain provisioning capability · global
address uniqueness · audit and rollback behaviour · how shared access should map to departments ·
whether personal mailbox creation can be automated or must stay operator-assisted.

**STOP condition:** if the existing schema cannot represent per-user mailbox membership, stop and
return the smallest additive model **and its RLS implications** before writing SQL.

---

## What is already known from earlier phases (starting points, not conclusions)

These are facts established by EMP-0/EMP-1/EMP-3 that the audit should begin from and verify:

* **`ec_mailbox` has no membership concept at all.** It is `(tenant_id, address, label_fr,
  purpose, is_active, note, created_by)`. There is no per-user link of any kind, so
  "who may use this mailbox" is currently answered only by tenant-wide permissions.
* **Address uniqueness is GLOBAL, not per tenant** — `uq_ec_mailbox_address` on `address`, with
  EC-1's stated reason: two tenants claiming one address would make routing a guess. Personal
  mailbox creation must respect that.
* **Access today is tenant-wide, not per mailbox.** RLS on all `ec_*` tables is
  `tenant_id = auth_tenant_id() AND has_permission('communication:inbound:read')` — any holder
  reads every mailbox in the tenant. Per-mailbox ACL was explicitly deferred at EMP-0 as
  **RATIFY-EMP-2**, and noted there as *"the only genuinely new security boundary EMP could
  introduce"*. **EMP-4A would introduce it**, so the STOP clause is live.
* **EMP-1 administers mailboxes but cannot create them** — activate/deactivate only, via the
  admin client behind `communication:manage`. Creation is currently an operator act, and
  `ec_mailbox` has **no INSERT policy** (no `ec_*` table has any write policy).
* **Send-as already has a distinct authority:** EMP-3 gates sending on `communication:send`
  and resolves the sender mailbox server-side from `ec_mailbox`, requiring it to be active and
  same-tenant. Any membership model must compose with that rather than replace it.
* **Departments are DERIVED from roles** (Phase 9.0A) — there is no department column on the
  user. A department→mailbox mapping therefore keys off the role-derived department, not a
  stored field.
* **No provider/domain provisioning capability exists.** The platform has a Resend *sending*
  integration only. Nothing in the codebase creates, verifies or manages a mailbox at a mail
  provider, and per-tenant sending domains were deferred at EMP-0 as **RATIFY-EMP-4**. The audit
  must determine whether personal mailbox creation can be automated **at all**, or must remain
  operator-assisted — the current evidence points firmly at operator-assisted.
* **The whole EC inbound workspace is dark:** `communication:inbound:read` is granted to no role
  pending **RATIFY-EC1-1**.

## Roadmap position

EMP-4A sits beside EMP-5 (AI suggestions) and EMP-6 (customer visibility), all unstarted. It
depends on nothing in EMP-5/EMP-6 and is not blocked by them.

**No work on EMP-4A has begun.**
