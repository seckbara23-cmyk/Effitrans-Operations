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

`lib/env.ts` fails fast with a clear message if a required variable is missing.

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

## 5. Run the app (existing mock UI)
```
npm run dev      # http://localhost:3000
npm run lint     # lint
npx tsc --noEmit # typecheck
npm run build    # production build
```
The current UI runs on static mock data (`lib/*.ts`); it does **not** require the
Supabase values to render. Those values are wired to real data from S2 onward.

## 6. What is NOT set up yet (by design)
Database schema · auth · RBAC · RLS · business tables · workflow · customs ·
document catalog. These are gated on later waves / the S2 blockers (BLK-1/3/6/9).
See [s0-backlog.md](s0-backlog.md) and [s0-readiness-checklist.md](s0-readiness-checklist.md).
