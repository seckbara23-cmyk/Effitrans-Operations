# DBC-0 — Digital Brand Center: Architecture Audit

Audit of the existing platform against the CEO memorandum. **No production behavior
changed in this phase** — documentation only. Companion documents: requirements matrix,
data-model proposal, security model, asset checklist, email-compatibility plan, roadmap.

---

## 1. Current architecture discovered

### 1.1 Branding (the closest existing module)
- **`tenant_branding`** (PK `tenant_id`): `display_name, logo_url, portal_logo_url,
  primary_color, secondary_color, email_footer, pdf_header_text, invoice_footer_text,
  support_email, support_phone, tagline`. One row per tenant.
- **`resolveTenantBranding()`** (`lib/branding/service.ts`) — request-cached, service-role
  read scoped to ONE tenant; merged with org identity + platform fallbacks by the pure
  `mergeBranding` (`lib/branding/resolve.ts`).
- **Validators** (`lib/branding/validate.ts`): `isValidHexColor` (#rgb/#rrggbb only),
  `isSafeUrl` (http/https only — rejects `javascript:`/`data:`), `safeText` (rejects any
  angle bracket). Already the right primitives for every DBC text/color/URL field.
- **Editor** (6.0E-1): `lib/branding/edit.ts` (pure draft validation, surfaced errors),
  `lib/platform/branding-actions.ts` (gated `platform:companies:update`, audits
  `platform.branding.updated` with **field names only**), `components/platform/branding-editor.tsx`
  (local preview, Cancel restores). **Platform-side write only — there is no tenant-side
  branding write today.** The DBC is a *tenant* module, so a tenant-side write path is a
  new (but small) contract.
- **Consumers**: email chrome (`brandWrap`), PDF header, portal.

**Gap vs. memorandum:** only 2 colors (primary/secondary — memo needs Green + Gold +
Anthracite + White), no fonts, no physical address, no legal identifiers, no social URLs,
no compliance block, no memberships, no slogan/value-proposition fields (tagline is one
line). → extended profile table proposed (see data-model doc). **Do not** widen
`tenant_branding` into a catch-all.

### 1.2 Employee identity
- **`app_user`**: `id (PK = auth.users.id), tenant_id, email, name, status,
  is_system_admin, created_at, updated_at` (+ presence `last_seen_at`, `last_login_at`,
  `onboarding_email_sent_at` from later migrations). One tenant membership per login.
- **Roles**: `user_role → role.code`; French labels + display priority already exist
  (`lib/navigation/roles.ts` — `primaryRoleLabel`, "what am I here to do" semantics).
- **Departments**: derivable from role (`lib/departments/classify.ts`) — no free-text field.

**Authoritative source for signature/business-card identity = `app_user` + `user_role`.**
**Missing contracts:** job title (a role label is not a business title — the CEO's title is
"Managing Director | CEO | Directeur Général"), office/mobile phone, WhatsApp, photo,
public-profile consent/visibility. → `workforce_profile` proposed; **no duplication of
name/email** (those stay on `app_user`).

### 1.3 Storage
- ONE bucket: **private `documents`** ("no public URLs, ever" — BLK-3 governance),
  deny-by-default `storage.objects` policy, server-mediated signed URLs, MIME map + size
  checks in `lib/documents/storage.ts` (`uploadObject`, signed URL, `remove`).
- **No public bucket exists.** This is exactly the 6.0E/6.0F deferred item ("approved
  public logo/favicon storage"). Email clients require **stable, public, non-expiring**
  image URLs (a signed URL expires → broken images in every previously-sent email), so a
  public bucket (or external CDN) is a hard prerequisite for signatures.

### 1.4 Email pipeline
- `lib/comms/`: `templates.ts` (typed `{{var}}` templates), `render.ts` (interpolation with
  **HTML escaping**, brand wrapper), `queue.ts` (`queueAndSend` — queues, sends via
  provider, audits QUEUED/SENT/FAILED), `provider.ts` (Resend or no-op; honest
  `isProviderConfigured`).
- The wrapper is **div-based with system fonts** — fine for transactional mail, **not
  signature-grade** (signatures must survive Outlook Desktop's Word renderer: tables,
  inline CSS, no div layout). Reuse the escaping + pipeline; build a separate table-based
  compiler for signatures.

### 1.5 Document generation
- **A real, dependency-free PDF engine exists**: `lib/reports/pdf.ts` (`PdfDoc` — raw PDF
  primitives, `Uint8Array` out) + `lib/reports/templates.ts` (`ReportLayout`: corporate
  header/footer, page numbers, KPI cards, auto-paginating tables, totals, **signature
  block**). Used by `executive-pdf.ts`. **This is the reuse target for letterhead / quote /
  invoice / proposal PDFs** — no new PDF library needed.
- **No DOCX, no PPTX, no QR, no image-processing library.** `package.json` is deliberately
  minimal (next/react/supabase/leaflet/tailwind only). DOCX/PPTX are OOXML (ZIP+XML) — a
  hand-rolled writer is feasible but significant; a static **approved editable master**
  (.docx/.pptx uploaded as brand assets) delivers the memo's value immediately.
- CSV/XLSX exports exist (`lib/reports/*`), audited (`report.export.*`).

### 1.6 Everything else already reusable
- **Audit**: `writeAudit` + typed catalog — extend with `brand.*` events (names only).
- **Permissions**: tenant registry includes `admin:config:manage` (tenant governance) —
  covers an MVP brand-center write surface; dedicated `brand:*` codes can come later.
- **Lifecycle enforcement**: `getCurrentUser` blocks suspended/archived tenants — any DBC
  page/action inherits it automatically via `requireUser`/`assertPermission`.
- **Public-surface pattern**: the portal (`/portal`) shows how a public, tenant-branded,
  RLS-safe surface is built — the model for digital business cards.
- **AI**: out of scope for DBC; no coupling.

---

## 2. Real contract gaps (the honest list)
| # | Gap | Resolution phase |
|---|---|---|
| G1 | No public asset storage (bucket or CDN) | DBC-1 (decision required) |
| G2 | No tenant-side branding write (platform-only today) | DBC-1 |
| G3 | Brand values beyond `tenant_branding` (gold/anthracite, fonts, address, legal, social, compliance, slogan) | DBC-1 (new table) |
| G4 | Employee title/phones/photo/consent | DBC-1/3 (`workforce_profile`) |
| G5 | Signature-grade (table-based, Outlook-safe) HTML compiler | DBC-2 |
| G6 | Membership registry (WCA/FIATA/AWS/EURA) | DBC-1 (table) or config |
| G7 | Public profile route + token + vCard + QR | DBC-3 |
| G8 | DOCX/PPTX generation | DBC-4/5 (masters first; generation deferred) |
| G9 | Email-client test evidence (Litmus/EoA account) | DBC-2 (external decision) |
| G10 | Official brand inputs (colors, logos, fonts…) | Blocking — see asset checklist |

## 3. Constraints
- **No new heavy dependencies** without a decision — the codebase is deliberately
  dependency-light; every generator so far is hand-rolled and unit-tested.
- **No-jsdom test convention** — generators must be pure functions (string/`Uint8Array`
  out) testable in node; UI asserted structurally. The PDF/email engines already follow this.
- **French-first UI**; generated artifacts follow the memo's language (EN/FR mixed).
- **`/login` static prerender** must survive any shell/nav change (proven pattern: gated
  API + client fetch).
- Signed URLs cannot back email images (expiry) → public bucket paths must be treated as
  **immutable + versioned** (cache-busting by filename, never by mutation).

## 4. Risks
- **Outlook Desktop (Word renderer)** is the compatibility long pole — mitigated by
  table-only layout, inline CSS, raster images, no VML (flat buttons via `bgcolor` cells).
  No compatibility claim without the test matrix (see compatibility plan).
- **Public bucket ≠ public tenant data**: only *approved brand assets* may live there;
  paths must be unguessable-enough or content deliberately public; upload strictly
  server-mediated + MIME/size-validated; **SVG never accepted for email** and sanitized
  (or converted) elsewhere — SVG is a script vector.
- **Public business cards** expose employee identity by design — needs explicit per-employee
  activation + revocation + unguessable token (no enumerable slugs).
- **Partner logos** (WCA/FIATA/…) carry third-party brand rules — store approval notes,
  never recolor/stretch; usage approval is a Brand-Book input, not a platform decision.
- **Scope explosion** — the memo lists ~20 deliverables; the roadmap bounds each phase and
  the MVP cuts to what changes daily work (signatures + identity).

## 5. Recommended module boundaries
```
lib/brand/            pure: types, validation, compilers (signature HTML, vCard, QR target)
lib/brand/server/     server-only: profile/membership/asset reads+writes, generation actions
app/(tenant)/brand/   tenant UI: Centre de marque (MVP sections)
app/card/[token]/     public business-card route (DBC-3; own layout, no tenant chrome)
storage: brand-assets (NEW public bucket, DBC-1; tenant-scoped paths, server-write-only)
```
Reuse verbatim: `escapeHtml`, branding validators, `writeAudit`, `assertPermission`,
`ReportLayout`/`PdfDoc`, `queueAndSend`, portal public-surface pattern.

## 6. Implementation sequence
See `dbc-roadmap.md`. Summary: DBC-1 foundation (bucket + profile + workforce + memberships)
→ DBC-2 signature engine → DBC-3 cards/vCard/QR → DBC-4 Word/PDF → DBC-5 PPTX/social →
DBC-6 marketing templates + governance. MVP navigation: 4 sections (Identité de marque,
Ressources visuelles, Signatures e-mail, Identité collaborateurs); the other memo sections
arrive with their phases.
