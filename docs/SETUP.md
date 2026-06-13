# Effitrans Operations Platform — Local Setup

Getting-started guide for local development. **Wave 0 scope** — foundation only.
There is no database schema, auth, RBAC, RLS, or business code yet; this covers
the environment contract and the Supabase project scaffold (S0-INF-1).

> Governance: this file is operational setup, not a planning document. Decisions
> live in [decision-register.md](decision-register.md) — the authoritative source.

---

## 1. Prerequisites
- Node.js (per the version used by Next.js 14 / React 18)
- npm (repo uses `package-lock.json`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for `supabase` commands)

## 2. Install
```
npm install
```

## 3. Environment variables
1. Copy the contract to a local, untracked env file:
   ```
   cp .env.example .env
   ```
   `.gitignore` ignores `.env` and `.env.*` (only `.env.example` is tracked) — never commit real secrets.
2. Fill in the Supabase values from your project dashboard (see comments in
   [`.env.example`](../.env.example)):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` — server only; never expose to the client

### Environment loading strategy (S0-INF-2)
`lib/env.ts` is the single entry point for environment access and **fails fast**
with a clear message if a required variable is missing:
- `getPublicEnv()` — client-safe vars (`NEXT_PUBLIC_*`); callable anywhere.
- `getServerEnv()` — adds server-only vars (`SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`); **server-side only** — these bypass RLS and must never reach the
  client bundle.

Rules: read env **only** through `lib/env.ts` (don't sprinkle `process.env`
across the app); Next.js auto-loads `.env` / `.env.local`; never import the
server env from a client component.

## 4. Supabase project (S0-INF-1)
The project config lives in [`supabase/config.toml`](../supabase/config.toml).

- **Platform:** approved (DEC-A06 / BLK-AR1).
- **Region:** **PROVISIONAL** — subject to BLK-9 (data residency). Keep it cheap
  to rebuild until BLK-9 is approved.

Link the local repo to your Supabase project:
```
supabase link --project-ref <your-project-ref>
```

### Changing the provisional region (BLK-9 outcome)
No data of value exists in Wave 0, so a region change is a rebuild:
1. Delete + recreate the Supabase project in the required region.
2. `supabase link --project-ref <new-ref>`
3. Reapply migrations (once the migration pipeline lands in S0-DB-4).
4. Update region notes in [decision-register.md](decision-register.md) (DEC-A06 / DEC-B09).

## 4b. Local database & migrations (S0-DB-4)
Migration mechanism: **Supabase CLI SQL migrations**, forward-only (DEC-A12).
Conventions: [`supabase/migrations/README.md`](../supabase/migrations/README.md).

> **Wave 1 status:** tooling + scripts only — there are **no migrations yet**
> (first table is `organization` in Wave 2). The commands below are ready for
> when migrations exist.

```
npm run db:start        # start local Supabase (requires Docker + Supabase CLI)
npm run db:status       # show local services / keys
npm run migration:new <name>   # create supabase/migrations/<timestamp>_<name>.sql
npm run db:reset        # rebuild schema from ALL migrations (must be reproducible)
npm run db:push         # apply pending migrations to the linked remote project
npm run db:types        # regenerate lib/db/types.ts from the local schema
npm run db:stop         # stop local Supabase
```
Prerequisite: install the [Supabase CLI](https://supabase.com/docs/guides/cli)
and Docker (for `db:start`). Link once with `supabase link --project-ref <ref>`.

## 5. Run the app (existing mock UI)
```
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build
# (npm run lint — ESLint not configured yet; set up with CI in a later wave)
```
The current UI runs on static mock data (`lib/*.ts`); it does **not** require the
Supabase values to render. Those values are wired to real data from S2 onward.

## 6. What is NOT set up yet (by design)
Database schema · auth · RBAC · RLS · business tables · workflow · customs ·
document catalog. These are gated on later waves / the S2 blockers (BLK-1/3/6/9).
See [s0-backlog.md](s0-backlog.md) and [s0-readiness-checklist.md](s0-readiness-checklist.md).
