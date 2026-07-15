# DBC — Security Model

Every guarantee below reuses an existing platform mechanism; nothing weakens RBAC, RLS,
lifecycle, or isolation.

## 1. Tenant isolation
- All DBC tables carry `tenant_id` with the standard tenant-scoped RLS (self-tenant read,
  deny-by-default writes) + tenant-match triggers where a row references `app_user`.
- Storage: `brand-assets/{tenantId}/…` paths; **writes only via server actions** (service
  role) that resolve the tenant from the session — never from client input; the bucket's
  `storage.objects` policy denies direct authenticated writes (mirror of the `documents`
  doctrine, but with public READ).
- Generated outputs (signature HTML, vCard, ZIP) are produced per-request from the
  caller's own tenant context (`getCurrentUser`) — no cross-tenant read path exists.
- The bidirectional RLS acceptance test pattern (6.0F) extends to the new tables.

## 2. Public exposure — deliberate and narrow
Two public surfaces, each intentionally public and nothing more:
1. **`brand-assets` bucket (public READ):** approved brand files only. Public ≠ secret:
   nothing sensitive may be uploaded (enforced by kind + MIME allowlist + gated action).
   Immutable versioned filenames double as cache-busting and revocation (deactivate +
   stop referencing; note: **already-sent emails keep old images by design** — true
   revocation of a public logo is a republish, not a delete).
2. **`/card/{token}` (DBC-3):** the digital business card. Exposes ONLY the approved
   fields (name, title, phones, email, links, tenant brand). Gated by
   `public_card_enabled` (explicit consent), keyed by an **unguessable ≥128-bit token**
   (no enumerable slugs, no sequential IDs), instantly revocable (disable/rotate token),
   and **blocked when the tenant is not operable** (the route re-checks lifecycle — a
   suspended tenant's cards go dark). It reads a fixed projection — it is not a general
   data-access path; RLS never relaxes for it (server-side service read of the fixed
   fields, mirroring the portal pattern).

## 3. Employee privacy
- Business-card publication is opt-in per employee (`public_card_enabled`), auditable
  (`brand.card.enabled/disabled`), and revocable. Photos are optional assets.
- vCard/QR only ever embed the same approved projection. QR encodes the profile URL —
  never raw contact data — so a revoked card kills the QR too.
- No analytics on public cards in MVP (privacy decision deferred and documented).

## 4. Link and URL validation
- All configurable URLs: `isSafeUrl` + **https-only** for compliance/social/website; the
  whistleblower URL additionally rendered exclusively as a button (never printed as text,
  per memo).
- QR destinations: only platform-generated profile URLs — no tenant-supplied QR targets.

## 5. HTML / file generation safety
- **Signature HTML:** deterministic server-side compiler; every dynamic value passes
  `escapeHtml` (existing, tested); no user-supplied markup, ever; no JavaScript, no
  external CSS by construction (template is code).
- **SVG:** never accepted for email assets; for web/doc use, either converted to PNG
  server-side or sanitized against script/event-handler/foreignObject content — decision
  in DBC-1 (simplest safe rule: PNG-only uploads in MVP).
- **vCard:** proper escaping of `,;\n`, line folding at 75 octets, UTF-8.
- **DOCX/PPTX masters:** uploaded as opaque binaries with MIME+extension+size checks; the
  platform does not parse them (no XML-injection surface in MVP). Generated OOXML (later
  phases) must XML-escape every value.
- **CSV/formula injection:** any future CSV export of brand data prefixes `=+-@`.
- **ZIP downloads:** streamed, filename-sanitized (no path traversal), size-capped,
  `Content-Disposition: attachment`.
- **External-image tracking:** signature images are self-hosted on the tenant's own
  bucket paths — no third-party pixels; no link-tracking redirection in MVP (policy:
  links are direct).

## 6. Permissions (proposal — nothing added in DBC-0)
- **MVP:** reuse tenant `admin:config:manage` for Centre de marque management and
  `admin:users:manage` for workforce-profile edits — both existing, tenant-scoped.
- **Later (when roles diverge):** dedicated `brand:center:read` / `brand:center:manage` /
  `brand:assets:manage` / `brand:employee-assets:generate` / `brand:compliance:manage`,
  tenant-scoped, seeded like existing permissions. A platform-side template-governance
  permission is justified only if platform-supplied default templates become editable —
  not in the MVP.
- Employees generating **their own** signature/vCard need no admin permission — the
  action scopes to `getCurrentUser()` self.

## 7. Audit (safe events)
`brand.profile.updated`, `brand.asset.uploaded/replaced`, `brand.membership.updated`,
`brand.compliance.updated`, `brand.signature.generated`, `brand.vcard.generated`,
`brand.card.enabled/disabled`, `brand.template.published`, `brand.download` — payloads
carry field names / kinds / paths / counts ONLY. **Never:** file contents, one-time
download tokens, public-card tokens, personal data beyond existing policy.

## 8. Public endpoints inventory (after full rollout)
| Endpoint | Auth | Exposure |
|---|---|---|
| `brand-assets/*` (storage) | none (public read) | approved brand files |
| `/card/{token}` | token (unguessable) | approved employee projection |
| `/card/{token}/vcard` | token | same projection, vCard format |
Everything else (editor, uploads, generation, downloads ZIP) is authenticated + gated.
