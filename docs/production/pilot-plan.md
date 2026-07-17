# Pilot Plan — Controlled Internal Pilot (Phase 8.0A)

## Scope

**Goal:** validate real operational use by internal staff plus 1–2 friendly customers, on the release candidate pinned in [release-manifest.md](release-manifest.md), with test data first and real dossiers only after conditions C1–C4 of the release decision are met.

### Pilot users (9–11)

| Role | Count | Identity class |
|---|---|---|
| SYSTEM_ADMIN | 1 | tenant admin |
| OPS_SUPERVISOR | 1 | management tier (also exercises `/dashboard/executive`) |
| CUSTOMS_DECLARANT | 1 | customs |
| DOCUMENTATION_OFFICER | 1 | documentation |
| TRANSPORT_OFFICER (coordinator) | 1 | road |
| DRIVER | 1 | driver-only landing (`/driver`) |
| FINANCE_OFFICER | 1 | finance |
| CEO | 1 | executive dashboard + copilot |
| Customer portal users | 1–2 | `client_user` (one per pilot customer) |

### Supported workflows

Dossier lifecycle (create → documents → customs → transport → invoice), ocean shipments (manual tracking studio), air shipments (manual events), road dispatch + driver portal + POD, customs intelligence transitions, document intelligence on searchable PDFs (suggestions only; 4 writable fields), customer portal (tracking, documents, invoices, notifications, AI assistant if AI enabled in that environment), brand center reads, executive dashboard, logistics copilot (if AI enabled).

### Excluded workflows

Online payments (dark), real-time GPS tracking (dark), 26-step process engine (dark), OCR of scanned documents (blocked on Azure conditions), GAINDE integration (blocked), automated carrier/AIS/airline feeds (deferred), marketing email sends to real customers.

### Data policy

- Weeks 1–2: **test data only** (test tenant, fictitious dossiers).
- Real dossiers only after: backup restore drill evidenced (F-4), environment separation confirmed (F-6), and the daily review has seen 3 clean days.
- No real customer personal data into AI features until the privacy items in the release decision are resolved.

## Go-live steps (day 0, in order)

1. Flip Vercel Deployment Protection to previews-only (F-1). **Verify** `/login` renders publicly.
2. Verify the served production SHA = manifest SHA (rollback-plan §Verify).
3. Confirm production env vars per environment-matrix §Verification (SITE_URL, email trio, Supabase trio) and that Preview does not point at the production database (F-6).
4. Live route sweep (15 min): `/login`, `/portal/login`, `/dashboard`, `/dashboard/executive`, `/departments/transport`, `/customs/intelligence`, `/shipping` (+ shipments/containers/vessels/voyages/ports/carriers/alerts), `/air` (+ shipments/airlines/airports/flights/ulds/alerts), `/brand-center`, `/platform`, `/portal`, one `/card/{token}`. Expect: login redirect or page — **no 404, no redirect loop**.
5. Identity acceptance (Part 5 matrix): one login per identity class listed above + platform admin; verify landing routes (staff→/dashboard, portal→/portal, platform-only→/platform, driver→/driver, courier→/courier), temp-password flow, password reset, session revocation, one suspended-tenant check. **Any privilege crossover = stop + NO-GO.**
6. Journey pass (Part 7): run the five journeys below on test data, recording outcomes in a copy of `docs/phase-6.0g-staging-acceptance.md`.
7. AI Preview acceptance (Part 8): with `AI_API_KEY` set in **Preview only**, run the six representative questions against the logistics, portal, and executive copilots; record provider/latency/tokens from the usage endpoint; verify fallback by unsetting the key; verify audit rows carry metadata only. Production AI stays dark until separately approved.
8. Email acceptance (Part 10): send one invitation + one welcome to a test mailbox via the configured provider; verify links carry the production URL; verify no temp password appears (unless the explicit opt-in flag path is intended).
9. Storage probe (Part 11): upload a document as staff; confirm a portal user of another customer cannot fetch it (signed URL + RLS); confirm brand-assets is public and documents is not.

## Journeys (Part 7 acceptance)

Ocean: dossier → customer → ocean shipment → carrier/booking/BL → container → vessel/voyage → ports/route → manual event (Tracking Studio preview→confirm) → map → customs handoff → documents → delivery milestone.
Air: shipment → airline/airport/flight → AWB → ULD → pieces → manual event → map → customs → documents → arrival/release.
Road: ready-for-dispatch → assign driver+vehicle → driver portal trip → status → POD → completion.
Customs: declaration → canonical transitions (7.1 state machine) → inspection → payment state → release → summary visible in shipping/air.
Portal: invite → password setup → login → own shipments only → map → documents → invoice → notification → AI assistant.

Record each step's observed outcome (pass/fail + screenshot) — no journey is "passed" without a record.

## Operating model

- **Support hours:** business hours (GMT), owner = SYSTEM_ADMIN pilot lead.
- **Issue escalation:** in-app observation → pilot lead → engineering; incidents per rollback-plan.md.
- **Incident owner:** pilot lead. **Rollback owner:** operator with Vercel + Supabase access.
- **Data correction:** through the app's own flows (audited); direct SQL only as a documented incident action.
- **Daily review (15 min):** Vercel runtime errors + `[observe]` log grep + audit-log anomalies + open feedback.
- **Feedback capture:** one shared tracker (issue per finding, classified with the audit's severity scale).

## Success criteria (2-week checkpoint)

- ≥ 10 real dossiers processed end-to-end without engineering intervention;
- 0 isolation/authorization incidents; 0 data-loss incidents;
- < 2 % request error rate over the pilot window (Vercel logs);
- every pilot role able to complete its journey unaided;
- portal customers can self-serve tracking + documents without staff help.

## Stop conditions (immediate pause + incident)

Any rollback trigger in rollback-plan.md — notably cross-tenant/customer exposure, privilege crossover, login failure for all users, data corruption, document loss, AI answering with unauthorized data.
