# Supabase Migrations — Conventions

Migration mechanism for the Effitrans platform per **DEC-A12**: plain, forward-only
SQL migrations managed by the **Supabase CLI**. No ORM migration tool. The typed
query/ORM layer is a separate, deferred decision.

> **Wave 1 scope (S0-DB-4):** this establishes the *tooling and conventions only*.
> There are **no migrations yet** — no `organization`, `audit_log`, RBAC, RLS, or
> business tables. The first migration arrives in Wave 2 (S0-DB-2).

---

## Creating a migration
```
npm run migration:new <short_snake_case_name>
```
This generates `supabase/migrations/<timestamp>_<name>.sql`. Edit it by hand.

## Applying / resetting locally
```
npm run db:start     # start local Supabase (Docker)
npm run db:reset     # drop, recreate, and re-apply ALL migrations from scratch
npm run db:push      # apply pending migrations to the linked project
npm run db:types     # regenerate lib/db/types.ts from the local schema
```

## Conventions
1. **Forward-only.** Never edit a migration that has been pushed/shared. To change
   something, add a **new** migration. (Mirrors the decision-register supersede rule.)
2. **One logical change per migration.** Keep them small and reviewable.
3. **Naming:** `<timestamp>_<verb_noun>.sql` (the CLI adds the timestamp), e.g.
   `..._create_organization.sql`, `..._enable_rls_organization.sql`.
4. **Reproducible:** `npm run db:reset` must rebuild the full schema identically
   from an empty database (S0-DB-4 acceptance criterion).
5. **Tenant + RLS rule (enforced from Wave 2 on):** any migration that creates a
   business/tenant-scoped table **must** in the same change add `tenant_id` and an
   RLS policy (see [database-design.md](../../docs/database-design.md) and the
   tenant_id convention). Reviewers reject business tables without it.
6. **No secrets** in migrations. No seed data that contains credentials.

## What does NOT belong here (yet)
Schema for operational files, documents, customs, workflow, RBAC, RLS — all gated
on later waves / the S2 blockers (BLK-1/3/6/9). See
[s0-backlog.md](../../docs/s0-backlog.md).
