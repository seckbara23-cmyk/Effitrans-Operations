# DBC — Implementation Roadmap

Bounded phases; each ships committed, CI-green, with acceptance criteria. **DBC-1 does not
start until the DBC-0 decisions (below) are approved and the blocking Brand-Book inputs
(`dbc-asset-checklist.md`) are supplied.**

## Decisions requiring approval before DBC-1
1. **Public asset hosting** = new platform-owned public `brand-assets` bucket (tenant-scoped
   paths, server-mediated writes, immutable versioned filenames). `effitrans.com/assets/…`
   optional mirror only if the website hosting contract is confirmed. *(Also resolves the
   long-deferred logo/favicon storage item.)*
2. **Data model** = 4 new tables (`tenant_brand_profile`, `workforce_profile`,
   `tenant_membership_registry`, `brand_asset`) — `tenant_branding` unchanged.
3. **Permissions MVP** = reuse `admin:config:manage` (+ `admin:users:manage` for workforce);
   dedicated `brand:*` codes deferred until roles diverge.
4. **Signature engine** = deterministic server-side compiler, table-based, **no VML**
   (flat buttons by design), PNG-only assets.
5. **Email testing** = Litmus/Email-on-Acid account (external) OR documented manual P0
   device pass — pick one; no compatibility claims otherwise.
6. **QR generation** = one tiny vetted dependency vs. hand-rolled encoder (codebase is
   dependency-light by doctrine — explicit call wanted).
7. **vCard 3.0** (max device compatibility) rather than 4.0.
8. **Wallet passes** = DEFERRED (both require external accounts + signing infrastructure).
9. **DOCX/PPTX** = static approved masters as downloadable assets + PDF generation via the
   existing engine; generated OOXML deferred.
10. **Public business cards** = opt-in per employee, unguessable token, no analytics in MVP.

## DBC-1 — Brand Foundation & Public Asset Infrastructure
Bucket `brand-assets` (public read, server-write-only, MIME/size validation, versioned
paths) · `tenant_brand_profile` + `tenant_membership_registry` + `brand_asset` +
`workforce_profile` migrations + RLS + RLS tests · tenant "Centre de marque" MVP nav
(Identité de marque · Ressources visuelles · Identité collaborateurs) · asset upload UI
(PNG-only MVP) · audit events · seeded Effitrans values from the approved Brand Book.
**Accept:** RLS suite green incl. new tables (bidirectional); assets publicly readable at
stable URLs; profile/membership editable by `admin:config:manage`; no SVG accepted; no
value invented (all from Brand Book).

## DBC-2 — HTML Signature Engine
Pure compiler (EXECUTIVE/MANAGEMENT/CORPORATE) + structural constraint tests in CI ·
preview page rendering the compiled string · copy-to-clipboard + `.html` download +
install guides (Outlook Desktop/New/Web, Gmail, Apple Mail, mobile) · compliance +
sustainability + membership blocks · `brand.signature.generated` audit.
**Accept:** compiler tests enforce tables-only/inline-only/no-script/escaped/≤600px/alt
mandatory; P0 client matrix executed with archived evidence; whistleblower URL never
visible as text.

## DBC-3 — Employee Digital Identity: Business Card, vCard, QR
Public `/card/{token}` route (own layout, tenant branding, lifecycle-gated, opt-in,
revocable) · vCard 3.0 generator (escaping/folding tests) · QR encoding the profile URL ·
per-employee enable/disable + token rotation · guides.
**Accept:** card off by default; token unguessable + rotatable; disabled/suspended → 404;
vCard imports correctly on iOS + Android; QR resolves to the live card and dies with it.

## DBC-4 — Word/PDF Corporate Documents
Letterhead / quote / invoice / proposal as PDF via the existing `PdfDoc`/`ReportLayout`
(brand palette from `tenant_brand_profile`) — extending the existing invoice/quote flows,
never forking them · editable `.docx` masters uploaded as brand assets + download page.
**Accept:** PDFs carry the approved identity block/colors/footer; masters downloadable;
no parallel invoice generator.

## DBC-5 — PowerPoint & Social Assets
Approved `.pptx` master (uploaded asset) with the memo's slide inventory · LinkedIn
banners + social/publication/announcement templates as fixed downloadable approved files ·
optimized asset package (ZIP download, streamed, sanitized).
**Accept:** all downloads audited; every file ≤ limits; nothing generated claims to be
approved unless sourced from the Brand Book.

## DBC-6 — Marketing Email Templates & Brand Governance
Portable table-based marketing template with merge-tag abstraction ({{merge}} →
Mailchimp/HubSpot/Dynamics dialects) — **no campaign sending** · template lifecycle
(DRAFT/APPROVED/PUBLISHED/RETIRED) + `brand_template` table + versioning · dedicated
`brand:*` permissions if role divergence has materialized.
**Accept:** exported templates import cleanly into at least one target platform (evidence);
governance states enforced server-side.

## Explicitly out of scope for all phases
Wallet passes (until accounts exist) · autonomous asset generation by AI · campaign
sending · tenant-editable HTML (raw markup) anywhere · partner-logo modification.
