# lib/db — generated database types

`types.ts` in this folder is **generated** from the local Supabase schema by:

```
npm run db:types     # supabase gen types typescript --local > lib/db/types.ts
```

- It is **not** written by hand and is regenerated after each migration.
- It does **not exist in the repo yet** — generate it with `npm run db:types` once
  your Supabase project is linked and the foundation migration
  (`20260613000001_create_foundation_tables.sql`) has been applied. The schema now
  has `organization`, `app_user`, and `audit_log` to type.
- Once generated, server/data-access code (`lib/data/`, added in later waves) will
  import these types. Client components must not import server-only DB access.

Scope guard: no schema, no business tables, no ORM models in Wave 1 (per DEC-A12).
