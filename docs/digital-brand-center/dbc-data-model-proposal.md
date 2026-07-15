# DBC — Data Model Proposal

Recommended additions ONLY — no migrations are written in DBC-0. Existing tables are
extended by **reference**, never duplicated. `tenant_branding` keeps its current runtime
role (email/PDF/portal chrome) unchanged; the DBC adds sibling tables.

## Design rules
- Every table is tenant-owned (`tenant_id → organization`, RLS tenant-scoped).
- Reads for the tenant UI go through RLS; privileged writes through gated server actions
  (the platform's universal pattern).
- No employee data duplicated into generated-asset records — generation reads live data.
- Text fields validated with the existing `safeText`/`isSafeUrl`/`isValidHexColor`.

## 1. `tenant_brand_profile` — extended brand identity (1:1 with organization)
**Purpose:** the memorandum's brand values that do not belong in the runtime
`tenant_branding` row. One row per tenant.

| Column | Notes |
|---|---|
| `tenant_id` PK → organization | cascade |
| `color_green`, `color_gold`, `color_anthracite` | hex, `isValidHexColor`; **values supplied by Brand Book, never invented** (white is a constant) |
| `font_primary`, `font_secondary`, `font_email_fallback` | text (e.g. Montserrat / Open Sans / Calibri) |
| `slogan` | safeText (e.g. "Performance in Motion") |
| `value_proposition` | safeText |
| `address_lines` | text[] or text, safeText |
| `legal_identifiers` | text (RC/NINEA…), safeText |
| `website_url`, `linkedin_url`, other social URLs | `isSafeUrl`, https-only |
| `compliance_portal_url` | https-only, server-validated; **rendered only as a button** |
| `compliance_*` overrides (title/subtitle/button/description) | nullable — template-controlled defaults; tenant override optional |
| `footer_line` | safeText, default = approved footer |
| `updated_at`, `updated_by` | audit trail anchor |

**RLS:** tenant members read own row; writes deny-by-default (server action gated by
`admin:config:manage` for MVP). **Audit:** `brand.profile.updated` (changed field names only).

## 2. `workforce_profile` — employee identity extension (1:1 with app_user)
**Purpose:** the signature/business-card fields `app_user` lacks. Name/email/status stay
authoritative on `app_user` (no duplication).

| Column | Notes |
|---|---|
| `user_id` PK → app_user | cascade |
| `tenant_id` → organization | RLS + guard (must match app_user.tenant_id — trigger like existing tenant-match patterns) |
| `job_title` | safeText — business title, distinct from role labels |
| `phone_office`, `phone_mobile`, `whatsapp` | normalized E.164-ish text, validated |
| `photo_asset_path` | reference into brand-assets (nullable) |
| `signature_variant` | enum EXECUTIVE / MANAGEMENT / CORPORATE (default CORPORATE) |
| `public_card_enabled` | boolean default false — explicit consent gate |
| `public_card_token` | unguessable (≥128-bit) token, unique, rotatable; NULL until enabled |
| `updated_at`, `updated_by` | |

**RLS:** self-read + admin-read within tenant; writes via gated action
(`admin:users:manage` or self-service subset — decision for DBC-1). **Audit:**
`workforce.profile.updated` (field names), `brand.card.enabled/disabled` .

## 3. `tenant_membership_registry` — international networks
**Purpose:** WCA First (ID 93972), FIATA, All World Shipping, EURA — displayable,
expirable, orderable. A dedicated table (not branding columns): memberships are a list
with lifecycle, and partner logos carry usage constraints.

| Column | Notes |
|---|---|
| `id` PK, `tenant_id` → organization | |
| `organization_name`, `membership_id` | safeText |
| `status` | active / inactive |
| `valid_from`, `expires_at` | dates, nullable |
| `logo_asset_path` | brand-assets reference (approved file only) |
| `official_url` | https-only |
| `display_order` | int |
| `asset_use_notes` | safeText — the partner's brand-rule notes ("do not recolor", approval ref) |

**RLS:** tenant read; gated writes. **Audit:** `brand.membership.updated`.

## 4. `brand_asset` — registry over the public bucket (DBC-1)
**Purpose:** the DB record for each approved file in the `brand-assets` bucket (the bucket
itself is storage; the registry gives type, version, and audit anchor).

| Column | Notes |
|---|---|
| `id` PK, `tenant_id` | |
| `kind` | logo / logo_reversed / logo_mono / icon / network / social / photo / master_docx / master_pptx / generated |
| `storage_path` | `brand-assets/{tenantId}/{kind}/{name}-v{n}.{ext}` — **immutable, versioned filenames** (email caching) |
| `mime`, `bytes` | validated server-side; ≤100 KB for images per memo; **SVG only for non-email kinds and sanitized** |
| `alt_text` | required for images (accessibility) |
| `active` | replacement = new version + deactivate old (no overwrite — old emails keep working) |
| `created_by`, `created_at` | |

**Audit:** `brand.asset.uploaded` / `brand.asset.replaced` (path + kind, never file bytes).

## 5. Deferred (NOT in DBC-1)
- `brand_template` (DRAFT/APPROVED/PUBLISHED/RETIRED lifecycle + versioning) — needed only
  when templates become tenant-editable (DBC-6). MVP templates are code-controlled.
- Wallet pass records — deferred with the feature.
- Analytics on public cards — privacy decision first.

## Relationship map
```
organization 1—1 tenant_branding        (existing, unchanged)
organization 1—1 tenant_brand_profile   (new)
organization 1—n tenant_membership_registry (new)
organization 1—n brand_asset            (new)
app_user     1—1 workforce_profile      (new)
```
Generation (signature/vCard/card) reads: app_user + workforce_profile +
tenant_branding + tenant_brand_profile + memberships + assets — **at generation time**,
never from copies.
