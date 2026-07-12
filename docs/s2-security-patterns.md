# S2 Security Patterns — mandatory patterns for business-domain work

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md).
> The Decision Register is the authoritative source; in case of conflict it takes precedence.

**Status:** PATTERNS ONLY — **no implementation, no schema**. This codifies the binding conditions from the [S0→S2 security review](s0-security-review.md) (F1, F8) so that when S2 begins, every business table and access path is secure and consistent by default. It makes **no assumption** about BLK-1/3/6/9 (integration approach, document catalog/expiry, file numbering, hosting region) — those are out of scope here.

Builds on the validated foundation: [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md) · the RLS helpers shipped in migration `…0003_rls_scope_hooks.sql` (`auth_tenant_id()`, `has_permission()`, `has_role()`).

---

## 1. The business-table checklist (every new table)

A migration that creates a business/tenant-scoped table is **not mergeable** unless it does all of the following in the **same migration**:

- [ ] **`tenant_id uuid not null references public.organization(id)`** (DEC-C01).
- [ ] Index leads with `tenant_id` on any multi-column lookup index.
- [ ] **`alter table … enable row level security;`** — no table ships without RLS.
- [ ] A **SELECT** policy scoped by `auth_tenant_id()` (+ a permission via `has_permission()` where the data is sensitive).
- [ ] **INSERT / UPDATE / DELETE** policies (the foundation deliberately has none — business writes are user-initiated and need explicit policies; see §3).
- [ ] `created_at` / `updated_at` + the `set_updated_at()` trigger where mutable.
- [ ] If the table records privileged actions, those actions also call `writeAudit()` (append-only).
- [ ] An RLS test added under `supabase/tests/` proving tenant isolation **and** the intended role scoping (CI runs them — F4).

> Reviewers reject any business table missing `tenant_id` + RLS + write policies. This is the single most important rule carried out of S0.

---

## 2. SELECT policy templates

Reuse the foundation helpers — do not re-inline subqueries.

**Tenant-scoped read (default):**
```
create policy <table>_select_tenant
  on public.<table> for select to authenticated
  using (tenant_id = public.auth_tenant_id());
```

**Tenant + permission-scoped read (sensitive data):**
```
create policy <table>_select_scoped
  on public.<table> for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('<module>:read:all'));
```

**Owner / assignment scope (own files only — e.g. a declarant):**
```
-- requires an ownership/assignment column on the row, e.g. assigned_to / account_manager_id
using (
  tenant_id = public.auth_tenant_id()
  and (
    has_permission('<module>:read:all')
    or assigned_to = auth.uid()
  )
)
```
The own/team/client/all scopes from [rbac-matrix.md §4](rbac-matrix.md) compose from these building blocks.

---

## 3. WRITE policy templates (the S0 gap to close in S2)

The foundation has **no write policies** (writes ran via the service role). Business tables take user-initiated writes, so they **must** define them. Always use **`with check`** to prevent writing rows into another tenant.

**Insert (must land in caller's tenant + hold the permission):**
```
create policy <table>_insert
  on public.<table> for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('<module>:create:...')
  );
```

**Update (row in tenant; cannot move it out via the new value):**
```
create policy <table>_update
  on public.<table> for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('<module>:update:...'))
  with check (tenant_id = public.auth_tenant_id());
```

**Delete / archive:** prefer **soft-delete / state transition** over hard `delete`. Where a hard delete is unavoidable, gate it with `using (… has_permission('<module>:delete:…'))`. Note the **archive-lock** rule (operational files become read-only after POD) is enforced as a state guard, not a delete.

**Append-only tables** (like `audit_log`): never grant UPDATE/DELETE; rely on the `prevent_mutation()` trigger pattern.

---

## 4. Data-access (repository) layer pattern

S2 must keep UI and data access decoupled, and keep server-only/service-role code off the client.

- **Read paths** go through the **user-context** server client (`getServerSupabaseClient`) so RLS applies — exactly like `lib/audit/read.ts`. Never read user data with the admin client.
- **Privileged writes** (rare; e.g. system/admin operations) use the admin client **only** inside `server-only` modules, and **must** call `writeAudit()`.
- Put business reads/writes in `lib/data/<module>/…` (server modules), returning typed domain objects — not raw rows — so components depend on a stable shape.
- **Client components never import** `lib/supabase/admin`, `lib/supabase/server`, `lib/audit/log`, or `getServerEnv`. The `server-only` guard + the CI/grep check enforce this.
- Regenerate `lib/db/types.ts` (`npm run db:types`) after each migration so the repository layer is typed against the real schema.

```
UI (client/server component)
  → lib/data/<module>/repository.ts (server)
      → getServerSupabaseClient()  (RLS-scoped reads)
      → [privileged] admin client + writeAudit()  (server-only)
```

### 4.1 Service-role reads MUST be tenant-scoped (Phase 4.0A)

In practice many list/KPI/aggregate reads use the **service-role admin client**
(it bypasses RLS for performance and for cross-cutting reads). On those paths RLS
is **not** a backstop — tenant isolation depends entirely on a `tenant_id` filter
being present. A single omission is a silent cross-tenant leak.

Rules for any `getAdminSupabaseClient()` **read**:

- **Default:** use `scopedFrom(admin, "<table>", tenantId)` from
  [`lib/db/tenant-scope.ts`](../lib/db/tenant-scope.ts). It asserts a valid tenant
  and injects `.eq("tenant_id", tenantId)` structurally, so the filter cannot be
  forgotten. `.select(...)`, `.returns<T>()`, `.in/.is/.eq`, count/head all chain
  as usual.
- **Equivalent:** a hand-written `.eq("tenant_id", tenant)` on the same chain is
  accepted (the pre-4.0A idiom).
- **Exceptions** (fetch-by-unique-id after the parent was tenant-verified;
  self-identity lookup by `auth.users` id; the intentional global dual-identity
  guard) are enumerated with a reason in `KNOWN_UNSCOPED_READS` in
  [`tests/tenant-scope.test.ts`](../tests/tenant-scope.test.ts). Adding an entry
  is a deliberate, reviewed decision — prefer scoping the read instead.

The **tenant-scope guard** (`tests/tenant-scope.test.ts`, runs in the unit-test
CI job) statically fails the build if a new admin-client `.select` on a
tenant-scoped table is neither tenant-filtered nor allow-listed. The tenant-scoped
table registry is [`lib/db/tenant-tables.ts`](../lib/db/tenant-tables.ts).

> Writes are out of this guard's scope: they filter by UUID primary key, and the
> action layer authorizes the row first. A future increment may extend the same
> discipline to service-role writes.

---

## 5. Storage RLS pattern (F8 — when documents arrive, S5)

> Document storage is **out of scope until S5** and depends on the document catalog (BLK-3). This is the *pattern*, not an instruction to create buckets now.

- One private bucket for operational documents; **never public**.
- Object key path encodes the tenant: `:::tenant_id/:::file_id/:::filename` so policies can match on the path prefix.
- Storage RLS policies (on `storage.objects`) mirror the table pattern: the caller may read/write an object only when the path's `tenant_id` segment equals `auth_tenant_id()` **and** they hold the relevant document permission.
- Uploads from the client portal (P2) go through a server action that validates tenant + permission before issuing a signed upload — clients never get the service-role key.
- Add Storage RLS tests alongside the table tests.

---

## 6. What this document does NOT cover (intentionally)
- The operational/customs/document/transport/notification **schema** itself (S2+, gated on BLK-1/3/6/9).
- File-numbering format (BLK-6), document catalog/expiry rules (BLK-3), GAINDE/Orbus integration (BLK-1), hosting region (BLK-9).
- Login hardening / MFA / rate-limiting (F3 — pre-production).

These are tracked in the [decision register](decision-register.md) and [readiness checklist](s0-readiness-checklist.md). When their blockers close, apply the patterns above to the resulting tables.

---

## 7. Pre-S2 enablement checklist (recommended before the first S2 merge)
- [x] RLS regression tests in CI (F4) — done (interim task 1).
- [x] Foundation unit tests + `npm test` in CI (interim task 2).
- [ ] Generated `lib/db/types.ts` from the linked schema (replace the stopgap) — run `npm run db:types`.
- [ ] This pattern doc reviewed/accepted by the team as the S2 standard.
- [ ] RBAC reconciled (BLK-RB1) + named System Admin assigned (BLK-RB2).
