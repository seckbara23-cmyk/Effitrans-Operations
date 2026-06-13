# Effitrans Operations Platform — Technical Architecture (Phase 1)

**What we are building:** a focused logistics **operations control tower** — Operational File + workflow state machine + documents + expiry alerts + customs reference tracking + transport/POD + dashboards. **Not** a full ERP.

**Architecture principle:** keep it a single full-stack app for 65 internal users + a small client portal. No microservices, no event-sourcing, no custom auth, no rebuilt accounting. Tenant-ready underneath, but no SaaS control plane.

Related: [requirements.md](requirements.md) · [database-design.md](database-design.md) · [phase-1-roadmap.md](phase-1-roadmap.md)

---

## 1. Stack decision

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **Next.js 14 App Router + React 18 + Tailwind** (already in repo) | Mock UI exists; keep it. FR-first i18n already scaffolded (`lib/i18n.ts`). |
| Backend | **Next.js Route Handlers / Server Actions** (monolith) | One deploy, one language, fastest path for a 65-user tool. Split to a separate API only if Phase 3 commercialization demands it. |
| Database | **PostgreSQL via Supabase** | Roadmap already names Supabase. Gives Postgres + RLS (tenant + role visibility), Auth, Storage, and scheduled functions in one platform. |
| Auth | **Supabase Auth** (session-based) | No custom auth. Maps to `app_user`; RBAC enforced server-side. |
| Object storage | **Supabase Storage** (S3-compatible) | Documents stored as files, never DB blobs. Region configurable (data residency). |
| Background jobs | **Supabase scheduled functions / cron** (or a small worker) | The **expiry scan + notification dispatch** run here — essential infra, not optional. |
| Notifications | Email (transactional provider) + SMS (regional gateway) | Phase 1. WhatsApp Business API via BSP = Phase 2. |
| ORM / data access | Prisma **or** Supabase client + typed SQL | Either; keep migrations versioned. RLS is the security boundary regardless. |

> **Why Supabase over rolling our own Postgres + auth + storage + cron:** it collapses four pieces of infrastructure the project needs anyway into one managed platform, and its RLS-first model is exactly how we want to enforce both tenant isolation and role-based file visibility. The trade-off (vendor coupling) is acceptable for Phase 1 and reversible — it's still plain Postgres underneath.

---

## 2. Multi-tenancy (answers Q32 technically)

**Single-tenant deployment, multi-tenant-ready schema.**
- Every business table has `tenant_id`; Effitrans is `organization` row 1.
- **Postgres RLS** enforces `tenant_id` isolation on every table + role-based file scoping ([rbac-matrix.md](rbac-matrix.md)).
- **Not built in Phase 1:** tenant onboarding, tenant admin console, subscription billing, per-tenant theming/config. That SaaS control plane is **Phase 3, only if commercialization is funded**.
- Retrofitting tenancy later would be expensive; carrying `tenant_id` now costs a few percent of schema discipline and preserves the option.

---

## 3. Integration strategy — reference-tracking first

| External system | Phase 1 approach | Upgrade path |
|---|---|---|
| **GAINDE** (customs) | **Capture declaration ref + status manually**; declarants keep working in GAINDE's own UI | Real API sync only if [BLK-1](requirements.md#7-blocking-questions) confirms one exists (Phase 2+) |
| **Orbus Infinity** (disbursements) | **Capture disbursement ref + payment status manually** | Same — API only if confirmed |
| **Maya** (invoicing) | **Untouched in Phase 1**; keeps running | Replaced by native billing in **Phase 2** |
| **Sage** (accounting) | **Untouched**; not integrated in Phase 1 | Export billed files to Sage in **Phase 2**; **never rebuild accounting** |

**The #1 technical risk is assuming these have clean APIs.** Until proven, every integration is manual reference-capture with the data entered once and linked to the file. This is a deliberate, documented choice — not a gap.

---

## 4. Component view

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js app (Vercel or container)                           │
│  ┌───────────────┐   ┌──────────────────────────────────┐   │
│  │ Internal UI    │   │ Client portal (own files only)   │   │
│  │ /dashboard …   │   │ tracking + upload + notifications│   │
│  └──────┬────────┘   └──────────────┬───────────────────┘   │
│         │ Server Actions / Route Handlers (RBAC enforced)    │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │ Workflow engine · checklist guards · expiry rules     │   │
│  └──────┬───────────────────────────────────────────────┘   │
└─────────┼─────────────────────────────────────────────────-─┘
          │
   ┌──────▼───────┐  ┌──────────────┐  ┌────────────────────┐
   │ Supabase      │  │ Supabase     │  │ Scheduled function │
   │ Postgres+RLS  │  │ Storage(docs)│  │ expiry scan +      │
   │ + Auth        │  │              │  │ notification queue │
   └───────────────┘  └──────────────┘  └─────────┬──────────┘
                                                   │
                                       ┌───────────▼──────────┐
                                       │ Email + SMS providers │
                                       └──────────────────────┘
```

---

## 5. Existing codebase reuse

The repo already has module shells with mock data (`lib/*.ts`). Phase 1 wires these to the real backend without UI rewrites:

| Existing route | Becomes |
|---|---|
| `/dashboard` | Operational + expiry + executive Tier-1 dashboards |
| `/shipments` (+ `[id]`) | Operational File list/detail (import/export/transport) |
| `/customs` (+ `[id]`) | Customs reference tracking |
| `/documents` (+ `[id]`) | Document management + expiry watchlist |
| `/customers` (+ `[id]`) | Clients + contacts |
| `/tasks` (+ `[id]`) | Tasks + my-queue |
| `/users` | Users + roles (RBAC admin) |
| `/finance` | **Placeholder only in Phase 1** (billing = Phase 2) |
| `/reports` | Tier-1 KPI reports |
| `/settings` | Org, workflow templates, document catalog config |

`lib/*.ts` mock data files become the seed/typing reference for the real schema.

---

## 6. Non-goals (Phase 1) — explicit
- ❌ General ledger, statutory financial statements, trial balance, cash-flow statement (Sage owns this — **never** rebuild)
- ❌ Billing/invoicing (Phase 2)
- ❌ Full BI / management control / budgeting (Phase 3)
- ❌ Live GAINDE/Orbus/Sage APIs (reference-tracking until confirmed)
- ❌ Microservices, event-sourcing/CQRS, custom auth, NoSQL core
- ❌ Multi-tenant SaaS control plane (Phase 3, if funded)
- ❌ Warehousing/consolidation/ship-agency/moving modules (Phase 3+)

---

## 7. Cross-cutting concerns
| Concern | Phase 1 approach |
|---|---|
| **Security** | RLS as the boundary; RBAC checked server-side on every action; portal strictly own-data |
| **Auditability** | `audit_log` (append-only) on every state change + privileged action; overrides logged with reason |
| **i18n** | French-first, EN secondary (existing `lib/i18n.ts`) |
| **Data residency** | Storage region configurable; confirm requirement [BLK-9](requirements.md#7-blocking-questions) |
| **Connectivity** | Tolerate intermittent field/port networks; confirm offline needs [BLK-7](requirements.md#7-blocking-questions) |
| **Observability** | Basic request + job logging; alert on failed notification/expiry-scan runs |
| **Backups** | Supabase managed backups; document break-glass for single-admin risk |

---

## 8. Blocking questions
| ID | Question | Blocks |
|---|---|---|
| BLK-1 | GAINDE / Orbus real API availability? | Integration vs manual reference |
| BLK-9 | Data residency / hosting constraints (oil & gas client docs)? | Supabase region / self-host decision |
| BLK-AR1 | Is Supabase acceptable to Effitrans IT, or is on-prem/regional hosting mandated? | Platform choice |
| BLK-AR2 | Deployment target — Vercel managed vs self-hosted container? | Ops model |
| BLK-AR3 | Existing SSO/identity provider to integrate (vs standalone Supabase Auth)? | Auth model ([BLK-DB1](database-design.md#7-blocking-questions)) |
