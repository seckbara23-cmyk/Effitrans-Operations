# Security Review — Phase 8.0A

Targeted application-security review of the release candidate (`d9c2c26…`). Non-destructive; nothing was attacked in production. Builds on the Phase 6.0F cross-cutting review + threat matrix (`docs/phase-6.0f-security-review.md`) — this review re-verifies the load-bearing claims on the current SHA and covers the Phase-7 additions.

## Verdict summary

No isolation, authorization, or secret-exposure defect was found. The two HIGH items are environmental (public repo — F-2; Next.js advisory stack — F-3), both triaged in the findings register.

## Authentication & session

- Supabase Auth (email/password + Google OAuth) for staff and portal; separate portal identity (`client_user`, self-select RLS); platform admins a third identity. Session refresh in middleware; page-level guards authoritative (`require-user`, `assertPermission`, `getCurrentPortalUser`).
- Session revocation: implemented via ban (6.0E) — pilot checklist re-verifies live.
- Tenant lifecycle blocking enforced in middleware (6.0D) + `requireUser`.
- **F-7 (fixed this phase):** stale refresh tokens surfaced as middleware runtime errors; now caught and treated as signed-out (redirect to login) with a regression test.
- Brute force: Supabase Auth rate-limits credential endpoints (platform); app adds its own rate limits on AI routes and portal update-requests. No app-level login throttle beyond the platform's — acceptable for pilot; revisit at GA.

## Authorization & RLS

- RBAC: 23 role templates, seed↔template parity machine-enforced (`tests/role-templates.test.ts`); permission format invariant; DRIVER frozen at 4 permissions; no `platform:*` in tenant templates.
- RLS: bidirectional tenant isolation + role scoping proven by the real-Postgres suite (`supabase/tests/rls_tenant_isolation_test.sql`) — **green in CI run #166 on this SHA**, covering platform core, tenant identity, customs, shipping, air, brand center, doc-intelligence, portal + carriage tables (7.5A added `portal_can_read_shipment`).
- Adversarial checks (code-level, this audit): portal identity cannot reach staff APIs (`assertPermission` throws for non-staff; portal copilot gates on portal identity and never asserts staff permissions — tested); tenant admin cannot reach `/platform` (separate `platform_admin` identity); server actions resolve tenant from the session, never from client arguments (spot-checked shipping/air/customs actions); direct-URL manipulation lands on uniform 404s (portal dossiers) — tested in 7.6C.
- Cross-tenant FK injection: inserts derive `tenant_id` server-side from the actor; RLS rejects mismatched child rows. Covered by the SQL suite.
- **Live adversarial pass on the deployed environment remains a pilot-day step** (blocked today by F-1 protection wall).

## Secrets

- Only 3 required secrets; service-role key server-only (`lib/supabase/admin.ts` behind `server-only`). Bundle scan: no key patterns, no server env names in `.next/static` (I-2). Git history scan: no committed `.env` (except `.env.example`), no key-shaped strings (F-2 mitigation). AI keys never returned by any endpoint (`getCopilotConfig` returns booleans/names only; portal GET returns `{available}` only).

## Injection surfaces

- **SQL:** no string-built SQL in app code; all access via supabase-js builders. The AI has no SQL/tool path (structural tests).
- **XSS/HTML:** React escaping; no `dangerouslySetInnerHTML` in app code (checked); email HTML built by the deterministic signature compiler with escaping (DBC-2).
- **Prompt injection:** every copilot's system prompt declares data-is-not-instruction + non-overridable rules; contexts are serialized allowlisted fields, never raw document bodies; reviewer free-text (`review_note`) deliberately excluded from AI context (7.6C); model output is text-only — no tools, no mutation path (structural tests across all four copilots).
- **SSRF/redirects:** no user-supplied URL fetch paths; AI base URL is env-controlled with hosted allowlist/HTTPS guard (I-5); login redirects are same-origin path rewrites only.
- **File uploads:** MIME + size validation on document upload; storage paths constructed server-side (tenant/dossier scoped), private bucket + signed URLs; `pdf-parse` runs server-only on searchable PDFs (7.4B), external package boundary in next.config.
- **Public tokens:** `/card/{token}` uses capability tokens with uniform-404 semantics + rotation (DBC-3); noindex headers set in middleware.

## Platform & headers

- Security headers on every route: XFO SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy, HSTS (preload). CSP deferred with plan (F-10).
- CSRF: session cookies are SameSite=Lax via @supabase/ssr; mutations are Next server actions (origin-checked by Next) or JSON POST routes requiring an authenticated session — no state-changing GETs found.
- Dependencies: F-3 (Next 14.2.35 — triaged, upgrade scheduled), F-13 (esbuild dev-only). `qrcode`, `pdf-parse`, `leaflet`, supabase libs: no open advisories at audit time; hand-rolled OOXML/ZIP/PDF generators have no external parser exposure (they generate, never parse untrusted input).
- Audit integrity: append-only enforced at DB level (UPDATE/DELETE triggers), attribution fail-closed (`validateAuditEvent`).

## Privacy & Senegal (Part 22 — engineering posture; NOT legal clearance)

- Data minimization is designed-in: AI contexts exclude PII beyond names/refs; audit stores metadata not content; driver personal phone never shared by default; portal users see only their own customer's data.
- Tracking coordinates: manual events only in pilot (real-time flags dark); portal sees a position only when marked customer-visible.
- External transfer: AI (OpenAI, US) would process operational summaries containing client names when enabled → include in counsel scope + privacy notice before enabling AI on real data; Azure OCR already conditioned on a signed DPA (7.4C-0).
- Retention/deletion, consent, privacy notices, CDP Senegal declaration: **open legal items** — flagged to counsel; engineering cannot claim compliance (release condition C7).

## Not executed (explicitly)

Destructive penetration testing; live adversarial testing against production (blocked by F-1, scheduled at pilot start); social-engineering scope.
