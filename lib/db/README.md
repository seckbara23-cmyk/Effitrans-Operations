# lib/db — generated database types

`types.ts` in this folder is **generated** from the local Supabase schema by:

```
npm run db:types     # supabase gen types typescript --local > lib/db/types.ts
```

- It is **not** written by hand and is regenerated after each migration.
- It does **not exist yet** — there is no schema in Wave 1 (no tables until S0-DB-2,
  Wave 2). Running `db:types` against an empty database is a no-op worth skipping
  until the first migration lands.
- Once generated, server/data-access code (`lib/data/`, added in later waves) will
  import these types. Client components must not import server-only DB access.

Scope guard: no schema, no business tables, no ORM models in Wave 1 (per DEC-A12).
